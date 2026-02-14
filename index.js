const express = require("express");
const session = require("express-session");
const passport = require("passport");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const expressWs = require("express-ws");
const { db } = require("./handlers/db.js");
const translationMiddleware = require("./handlers/translation");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const theme = require("./storage/theme.json");
const analytics = require("./utils/analytics.js");
const crypto = require("node:crypto");
const { loadPlugins } = require("./plugins/loadPls.js");
const { init } = require("./handlers/init.js");
const log = new (require("cat-loggr"))();
const config = require("./config.js");

const app = express();
expressWs(app);

let plugins = loadPlugins(path.join(__dirname, "./plugins"));
plugins = Object.values(plugins).map((plugin) => plugin.config);

// ================= SESSION =================
const sqlite = require("better-sqlite3");
const SqliteStore = require("better-sqlite3-session-store")(session);
const sessionStorage = new sqlite("sessions.db");

app.use(
  session({
    store: new SqliteStore({ client: sessionStorage, expired: { clear: true, intervalMs: 9000000 } }),
    secret: config.session_secret,
    resave: true,
    saveUninitialized: true,
  })
);

// ================= MIDDLEWARE =================
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(analytics);
app.use(translationMiddleware);
app.use(passport.initialize());
app.use(passport.session());

const postRateLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many requests" });
app.use((req, res, next) => { req.method === "POST" ? postRateLimiter(req, res, next) : next(); });

// ================= LANGUAGES =================
function getLanguages() {
  return fs.readdirSync(path.join(__dirname, "/lang")).map(file => file.split(".")[0]);
}
app.get("/setLanguage", async (req, res) => {
  const lang = req.query.lang;
  if (lang && getLanguages().includes(lang)) {
    res.cookie("lang", lang, { maxAge: 90000000, httpOnly: true, sameSite: "strict" });
    req.user.lang = lang;
    res.json({ success: true });
  } else res.json({ success: false });
});

// ================= GLOBAL SETTINGS =================
app.use(async (req, res, next) => {
  try {
    const settings = await db.get("settings");
    res.locals.languages = getLanguages();
    res.locals.ogTitle = config.ogTitle;
    res.locals.ogDescription = config.ogDescription;
    res.locals.footer = settings.footer;
    res.locals.theme = theme;
    res.locals.name = settings.name;
    res.locals.logo = settings.logo;
    res.locals.plugins = plugins;
    next();
  } catch (err) { log.error(err); next(err); }
});

// ================= CACHE =================
if (config.mode === "production") {
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "5");
    next();
  });
  app.use("/assets", (req, res, next) => { res.setHeader("Cache-Control", "public, max-age=1"); next(); });
}

// ================= VIEWS & STATIC =================
app.set("view engine", "ejs");
app.use(express.static("public"));

// ================= ROUTES =================
const routesDir = path.join(__dirname, "routes");
function loadRoutes(directory) {
  fs.readdirSync(directory).forEach(file => {
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) loadRoutes(fullPath);
    else if (path.extname(file) === ".js") {
      const route = require(fullPath);
      expressWs.applyTo(route);
      app.use("/", route);
    }
  });
}
loadRoutes(routesDir);

// PLUGINS
const pluginRoutes = require("./plugins/pluginManager.js");
app.use("/", pluginRoutes);
const pluginDir = path.join(__dirname, "plugins");
const PluginViewsDir = fs.readdirSync(pluginDir).map(addon => path.join(pluginDir, addon, "views"));
app.set("views", [path.join(__dirname, "views"), ...PluginViewsDir]);

// INIT & START
init();
const ascii = fs.readFileSync("./handlers/ascii.txt", "utf8");
console.log(chalk.gray(ascii.replace("{version}", config.version)));

app.listen(config.port, "0.0.0.0", () => log.info(`Skyport is listening on port ${config.port}`));

// 404
app.get("*", async (req, res) => {
  res.render("errors/404", { req, name: (await db.get("name")) || "Skyport" });
});
