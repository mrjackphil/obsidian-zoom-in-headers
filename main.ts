import {MarkdownView, Plugin} from 'obsidian';
import * as CodeMirror from 'codemirror';

export default class ZoomInHeaders extends Plugin {
    private zoomStates: WeakMap<CodeMirror.Editor, ZoomState> = new WeakMap();

    async onload() {
        console.log('loading zoom in header plugin')

        this.registerCodeMirror((cm) => {
            cm.on("beforeChange", this.handleBeforeChange);
            cm.on("change", this.handleChange);
            cm.on("beforeSelectionChange", this.handleBeforeSelectionChange);
        });

        this.registerDomEvent(window, "click", this.handleClick);

        this.addCommand({
            id: "zoom-in",
            name: "Zoom in",
            callback: this.createCommandCallback(
                this.zoomIn.bind(this)
            )
        });

        this.addCommand({
            id: "zoom-out",
            name: "Zoom out",
            callback: this.createCommandCallback(
                this.zoomOut.bind(this)
            )
        });
    }

    onunload() {
        console.log('unloading plugin');
        this.app.workspace.iterateCodeMirrors((cm) => {
            cm.off("beforeSelectionChange", this.handleBeforeSelectionChange);
            cm.off("change", this.handleChange);
            cm.off("beforeChange", this.handleBeforeChange);
        });
    }

    private handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;

        let wrap = target;
        while (wrap) {
            if (wrap.classList.contains("CodeMirror-wrap")) {
                break;
            }
            wrap = wrap.parentElement;
        }

        if (!wrap) {
            return;
        }

        let foundEditor: CodeMirror.Editor | null = null;

        this.app.workspace.iterateCodeMirrors((cm) => {
            if (foundEditor) {
                return;
            }

            if (cm.getWrapperElement() === wrap) {
                foundEditor = cm;
            }
        });

        if (!foundEditor) {
            return;
        }

        const pos = foundEditor.coordsChar({
            left: e.x,
            top: e.y,
        });

        if (!pos) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        this.zoomIn(foundEditor, pos);

        foundEditor.setCursor({
            line: pos.line,
            ch: foundEditor.getLine(pos.line).length,
        });
    };

    private handleBeforeChange = (
        cm: CodeMirror.Editor,
        changeObj: CodeMirror.EditorChangeCancellable
    ) => {
        const zoomState = this.zoomStates.get(cm);

        if (
            !zoomState ||
            changeObj.origin !== "setValue" ||
            changeObj.from.line !== 0 ||
            changeObj.from.ch !== 0
        ) {
            return;
        }

        const tillLine = cm.lastLine();
        const tillCh = cm.getLine(tillLine).length;

        if (changeObj.to.line !== tillLine || changeObj.to.ch !== tillCh) {
            return;
        }

        this.zoomOut(cm);
    };

    private handleChange = (
        cm: CodeMirror.Editor,
        changeObj: CodeMirror.EditorChangeCancellable
    ) => {
        const zoomState = this.zoomStates.get(cm);

        if (!zoomState || changeObj.origin !== "setValue") {
            return;
        }

        this.zoomIn(cm, {
            line: cm.getLineNumber(zoomState.line),
            ch: 0,
        });
    };

    private handleBeforeSelectionChange = (
        cm: CodeMirror.Editor,
        changeObj: CodeMirror.EditorSelectionChange
    ) => {
        if (!this.zoomStates.has(cm)) {
            return;
        }

        let visibleFrom: CodeMirror.Position | null = null;
        let visibleTill: CodeMirror.Position | null = null;

        for (let i = cm.firstLine(); i <= cm.lastLine(); i++) {
            const wrapClass = cm.lineInfo(i).wrapClass || "";
            const isHidden = wrapClass.includes("zoom-header-plugin-hidden-row");
            if (visibleFrom === null && !isHidden) {
                visibleFrom = {line: i, ch: 0};
            }
            if (visibleFrom !== null && visibleTill !== null && isHidden) {
                break;
            }
            if (visibleFrom !== null) {
                visibleTill = {line: i, ch: cm.getLine(i).length};
            }
        }

        let changed = false;

        for (const range of changeObj.ranges) {
            if (range.anchor.line < visibleFrom.line) {
                changed = true;
                range.anchor.line = visibleFrom.line;
                range.anchor.ch = visibleFrom.ch;
            }
            if (range.anchor.line > visibleTill.line) {
                changed = true;
                range.anchor.line = visibleTill.line;
                range.anchor.ch = visibleTill.ch;
            }
            if (range.head.line < visibleFrom.line) {
                changed = true;
                range.head.line = visibleFrom.line;
                range.head.ch = visibleFrom.ch;
            }
            if (range.head.line > visibleTill.line) {
                changed = true;
                range.head.line = visibleTill.line;
                range.head.ch = visibleTill.ch;
            }
        }

        if (changed) {
            changeObj.update(changeObj.ranges);
        }
    };

    private zoomOut(editor: CodeMirror.Editor) {
        const zoomState = this.zoomStates.get(editor);

        if (!zoomState) {
            return false;
        }

        for (let i = editor.firstLine(), l = editor.lastLine(); i <= l; i++) {
            editor.removeLineClass(i, "wrap", "zoom-header-plugin-hidden-row");
        }

        zoomState.header.parentElement.removeChild(zoomState.header);

        this.zoomStates.delete(editor);

        return true;
    }

    private zoomIn(
        editor: CodeMirror.Editor,
        cursor: CodeMirror.Position = editor.getCursor()
    ) {
        const lineNo = cursor.line;

        let listStartLine = lineNo;

        const getRoot = () => {
            if (listStartLine === 0) {
                return 0
            }

            while (listStartLine >= 1) {
                const line = editor.getLine(listStartLine);
                if (HeaderParser.isHeader(line)) {
                    return listStartLine
                }
                listStartLine--;
            }
        }
        const parser = new HeaderParser(editor)

        const root: number | null = getRoot()

        if (root === undefined || root === null) {
            return false;
        }

        const currentInfo = parser.headerByStartLine(root)

        this.zoomOut(editor);

        for (let i = editor.firstLine(), l = editor.lastLine(); i <= l; i++) {
            if (i < root) {
                editor.addLineClass(i, "wrap", "zoom-header-plugin-hidden-row");
            }

            const isAfter = currentInfo?.endLine < i

            if (isAfter) {
                editor.addLineClass(i, "wrap", "zoom-header-plugin-hidden-row");
            }
        }

        const createSeparator = () => {
            const span = document.createElement("span");
            span.textContent = " > ";
            return span;
        };

        const createTitle = (content: string, cb: () => void) => {
            const a = document.createElement("a");
            a.className = "zoom-header-plugin-zoom-title";
            if (content) {
                a.textContent = content;
            } else {
                a.innerHTML = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";
            }
            a.onclick = (e) => {
                e.preventDefault();
                cb();
            };
            return a;
        };

        const createHeader = () => {
            const div = document.createElement("div");
            div.className = "zoom-header-plugin-zoom-header";
            const path = parser.pathByHeader(currentInfo)

            for (let c of path) {
                div.prepend(
                    createTitle(c.content, () => {
                        this.zoomIn(editor, {line: c.startLine, ch: 0})
                    })
                );
                div.prepend(createSeparator());
            }

            div.prepend(
                createTitle(this.app.workspace.activeLeaf.getDisplayText(), () =>
                    this.zoomOut(editor)
                )
            );

            return div;
        };

        const zoomHeader = createHeader();
        editor.getWrapperElement().prepend(zoomHeader);

        this.zoomStates.set(
            editor,
            new ZoomState(editor.getLineHandle(lineNo), zoomHeader)
        );

        return true;
    }

    createCommandCallback(cb: (editor: CodeMirror.Editor) => boolean) {
        return () => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);

            if (!view) {
                return;
            }

            const editor = view.sourceMode.cmEditor;

            const worked = cb(editor);

            if (!worked && window.event && window.event.type === "keydown") {
                (editor as any).triggerOnKeyDown(window.event);
            }
        };
    }

}

class HeaderParser {
    editor: CodeMirror.Editor

    constructor(editor: CodeMirror.Editor) {
        this.editor = editor
    }

    static isHeader(s: string): boolean {
        return /^#+\s/.test(s) || false
    }

    static getLevelFromContent(s: string): number {
        if (!HeaderParser.isHeader(s)) {
            return
        }

        return s.split(' ')[0].split('').length
    }

    get headersInfo(): HeadersInfo[] {
        const lines = this.editor.getValue().split('\n')

        return lines
            .map((l, i) => {
                return {
                    content: l,
                    isHeader: HeaderParser.isHeader(l),
                    line: i,
                }
            })
            .filter(e => e.isHeader)
            .map(e => {
                return {
                    startLine: e.line,
                    endLine: 0,
                    content: e.content,
                    level: HeaderParser.getLevelFromContent(e.content)
                }
            })
            .map((e, i, arr) => {
                let endOffset = i + 1
                while(endOffset < arr.length - 1) {
                    const nextHeader = arr[endOffset]
                    if (nextHeader.level <= e.level) {
                        return {
                            ...e,
                            endLine: nextHeader.startLine - 1
                        }
                    }
                    endOffset++
                }

                return {
                    ...e,
                    endLine: e.startLine + endOffset - 1
                }
            })
    }

    headerByStartLine(l: number): HeadersInfo | undefined {
        return this.headersInfo.filter(e => e.startLine === l)[0]
    }

    pathByHeader(h: HeadersInfo): HeadersInfo[] {
        const upperHeaders = this.headersInfo.filter(e => e.startLine < h.startLine).reverse()

        if (!upperHeaders.length) {
            return []
        }

        for (let i = 0; i < upperHeaders.length; i++) {
            if (upperHeaders[i].level >= h.level) {
                return upperHeaders.slice(0, i).reverse()
            }

        }

        return upperHeaders
    }
}

interface HeadersInfo {
    startLine: number
    endLine: number
    content: string
    level: number
}

class ZoomState {
    constructor(public line: CodeMirror.LineHandle, public header: HTMLElement) {
    }
}

