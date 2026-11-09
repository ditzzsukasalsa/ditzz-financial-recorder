"use strict";
// Vercel catch-all function: routes all /api/* requests through the existing Express app.
const app = require("../server/index");
module.exports = app;
