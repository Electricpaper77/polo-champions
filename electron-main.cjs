const { app, BrowserWindow } = require("electron");
const path = require("path");
function createWindow() { const win = new BrowserWindow({ width: 1600, height: 900, minWidth: 1000, minHeight: 640, title: "British Polo", backgroundColor: "#11261c", webPreferences: { contextIsolation: true, nodeIntegration: false } }); win.loadURL(process.env.ELECTRON_START_URL || `file://${path.join(__dirname, "dist", "index.html")}`); }
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
