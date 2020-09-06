// Adapted from https://github.com/maximegris/angular-electron/blob/master/main.ts

// import { dialog } from 'electron';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
require('module').globalPaths.push(path.join(__dirname, 'node_modules'));
require('sqlite3');
import * as url from 'url';
const Store = require('electron-store');
import { ipcMainHandler, ipcTimer } from './libs/ipc';
import TrayIcon from './libs/tray-icon';
import DataModel from './local-data/local-table';
import { hasPromptedForPermission, hasScreenCapturePermission, openSystemPreferences } from 'mac-screen-capture-permissions';
console.log('path electron', app.getPath('appData'));
const knex = require('knex')({
	client: 'sqlite3',
	connection: {
		filename: `${app.getPath('userData')}/gauzy.sqlite3`
	}
});

const dataModel = new DataModel();
dataModel.createNewTable(knex);

const store = new Store();

let serve: boolean;
const args = process.argv.slice(1);
serve = args.some((val) => val === '--serve');

let win: BrowserWindow = null;
let win2: BrowserWindow = null;
let win3: BrowserWindow = null;
let win4: BrowserWindow = null;
let tray = null;
let isAlreadyRun = false;
let willquit = false;

const getFromEnv = parseInt(process.env.ELECTRON_IS_DEV, 10) === 1;

const isEnvSet = 'ELECTRON_IS_DEV' in process.env;

const debugMode = isEnvSet
	? getFromEnv
	: process.defaultApp ||
	  /node_modules[\\/]electron[\\/]/.test(process.execPath);

/**
 * Electron window settings
 */
const mainWindowSettings: Electron.BrowserWindowConstructorOptions = {
	frame: true,
	resizable: true,
	focusable: true,
	fullscreenable: true,
	// kiosk: true,
	// to hide title bar, uncomment:
	// titleBarStyle: 'hidden',
	webPreferences: {
		nodeIntegration: true,
		webSecurity: false
	}
};

/**
 * Hooks for electron main process
 */
function initMainListener() {
	ipcMain.on('ELECTRON_BRIDGE_HOST', (event, msg) => {
		console.log('msg received', msg);
		if (msg === 'ping') {
			event.sender.send('ELECTRON_BRIDGE_CLIENT', 'pong');
		}
	});
}

/**
 * Create main window presentation
 */
function createWindow() {
	const sizes = screen.getPrimaryDisplay().workAreaSize;
	mainWindowSettings.frame = true;
	mainWindowSettings.title = 'Gauzy';
	if (debugMode) {
		process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

		mainWindowSettings.width = 800;
		mainWindowSettings.height = 600;
	} else {
		mainWindowSettings.width = sizes.width;
		mainWindowSettings.height = sizes.height;
		mainWindowSettings.x = 0;
		mainWindowSettings.y = 0;
	}

	win = new BrowserWindow(mainWindowSettings);

	let launchPath;

	if (serve) {
		require('electron-reload')(__dirname, {
			electron: require(`${__dirname}/../../../node_modules/electron`)
		});

		launchPath = 'http://localhost:4200';

		win.loadURL(launchPath);
	} else {
		launchPath = url.format({
			pathname: path.join(__dirname, 'index.html'),
			protocol: 'file:',
			slashes: true
		});

		win.loadURL(launchPath);
	}

	console.log('launched electron with:', launchPath);

	win.on('closed', () => {
		// Dereference the window object, usually you would store windows
		// in an array if your app supports multi windows, this is the time
		// when you should delete the corresponding element.
		win = null;
	});

	initMainListener();

	// if (debugMode) {
	// 	// Open the DevTools.
	// 	win.webContents.openDevTools();
	// 	// client.create(applicationRef);
	// }
}

/* create second window */
function createSetupWindow(value) {
	mainWindowSettings.width = 800;
	mainWindowSettings.height = 800;
	mainWindowSettings.frame = true;
	mainWindowSettings.title = 'Setup';
	win2 = new BrowserWindow(mainWindowSettings);
	const launchPath = url.format({
		pathname: path.join(__dirname, 'ui/index.html'),
		protocol: 'file:',
		slashes: true
	});
	win2.loadURL(launchPath);
	if (value) {
		win2.hide();
	}
}

function timeTrackerWindow() {
	mainWindowSettings.width = 900;
	mainWindowSettings.height = 600;
	mainWindowSettings.title = 'Time Tracker';
	mainWindowSettings.webPreferences.devTools = true;
	win3 = new BrowserWindow(mainWindowSettings);
	const launchPath = url.format({
		pathname: path.join(__dirname, 'ui/index.html'),
		protocol: 'file:',
		slashes: true,
		hash: '/time-tracker'
	});
	win3.loadURL(launchPath);
	win3.hide();
	// if (debugMode) {
	// 	// Open the DevTools.
	// 	win3.webContents.openDevTools();
	// 	// client.create(applicationRef);
	// }
}

function startServer(value) {
	process.env.IS_ELECTRON = 'true';
	if (value.db === 'sqlite') {
		process.env.DB_TYPE = 'sqlite';
	} else {
		process.env.DB_TYPE = 'postgres';
		process.env.DB_HOST = value.dbHost;
		process.env.DB_PORT = value.dbPort;
		process.env.DB_NAME = value.dbName;
		process.env.DB_USER = value.dbUsername;
		process.env.DB_PASS = value.dbPassword;
	}
	if (value.isLocalServer) {
		process.env.port = value.port;
		require(path.join(__dirname, 'api/main.js'));
	}

	try {
		const config: any = {
			...value,
			isSetup: true
		};
		store.set({
			configs: config
		});
	} catch (error) {}
	/* ping server before launch the ui */
	console.log('run this');
	ipcMain.on('app_is_init', () => {
		console.log('app is init');
		try {
			if (!isAlreadyRun && value) {
				win2.webContents.send('server_ping', {
					host: value.serverUrl
						? value.serverUrl
						: value.port
						? `http://localhost:${value.port}`
						: 'http://localhost:3000'
				});
			}
		} catch (error) {
			console.log(error);
		}
	});
	return true;
}

try {
	// app.allowRendererProcessReuse = true;

	// This method will be called when Electron has finished
	// initialization and is ready to create browser windows.
	// Some APIs can only be used after this event occurs.
	// Added 5000 ms to fix the black background issue while using transparent window.
	// More details at https://github.com/electron/electron/issues/15947
	app.on('ready', async () => {
		// check premission for mac os
		if (process.platform === 'darwin') {
			const screenCapturePermission = hasScreenCapturePermission();
			if (!screenCapturePermission) {
				const haspromp = hasPromptedForPermission();
				console.log('prop', haspromp);
				const sysPref = await openSystemPreferences();
				console.log(sysPref);
			}
		}
		// the folder where all app data will be stored (e.g. sqlite DB, settings, cache, etc)
		process.env.GAUZY_USER_PATH = app.getPath('userData');
		// C:\Users\USERNAME\AppData\Roaming\gauzy-desktop
		// dialog.showMessageBox(null, { message: `GAUZY_USER_PATH: ${process.env.GAUZY_USER_PATH}` });

		require(path.join(__dirname, 'desktop-api/main.js'));

		try {
			const configs: any = store.get('configs');
			if (configs.isSetup) {
				global.variableGlobal = {
					API_BASE_URL: configs.serverUrl
						? configs.serverUrl
						: configs.port
						? `http://localhost:${configs.port}`
						: 'http://localhost:3000'
				};
				createSetupWindow(true);
				startServer(configs);
			}
		} catch (e) {
			createSetupWindow(false);
		}

		ipcMainHandler(store, startServer, knex);
	});

	app.on('window-all-closed', quit);

	ipcMain.on('server_is_ready', () => {
		console.log('this server is ready');
		try {
			isAlreadyRun = true;
			timeTrackerWindow();
			setTimeout(() => {
				win2.hide();
				createWindow();
				ipcTimer(store, knex, win2, win3, win4);
				const auth = store.get('auth');
				tray = new TrayIcon(win2, knex, win3, auth);
				win3.on('close', (event) => {
					console.log('close', event);
					if (willquit) {
						app.quit();
					} else {
						event.preventDefault();
						win3.hide();
					}
				});
				}, 1000);
		} catch (error) {
			console.log(error);
		}
	});

	ipcMain.on('quit', quit);

	ipcMain.on('minimize', () => {
		win.minimize();
	});

	ipcMain.on('maximize', () => {
		win.maximize();
	});

	ipcMain.on('restore', () => {
		win.restore();
	});

	app.on('activate', () => {
		// On macOS it's common to re-create a window in the app when the
		// dock icon is clicked and there are no other windows open.
		if (win === null) {
			createWindow();
		}
	});

	app.on('before-quit', () => {
		willquit = true;
	});
} catch (err) {}

// On OS X it is common for applications and their menu bar
// to stay active until the user quits explicitly with Cmd + Q
function quit() {
	if (process.platform !== 'darwin') {
		app.quit();
	}
}
