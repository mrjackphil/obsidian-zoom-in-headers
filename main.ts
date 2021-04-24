import {Plugin} from 'obsidian';

export default class ZoomInHeaders extends Plugin {
    async onload() {
        console.log('loading zoom in header plugin')
    }

    onunload() {
        console.log('unloading plugin');
    }
}
