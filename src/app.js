import "dotenv/config";
import express from "express";
import cors from "cors";

import eventRoutes from "./routes/eventRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import promoRoutes from "./routes/promoRoutes.js";
import authRoutes from "./routes/authRoutes.js";

const app = express();

app.use(
  cors({
    origin: "*",
  }),
);
import session from "express-session";
import passport from "passport";
import "./config/passport.js";

app.use(
  session({
    secret: process.env.SESSION_SECRET || "keyboard cat",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/promos", promoRoutes);

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Basic error logging
  // eslint-disable-next-line no-console
  console.error(err);
  if (res.headersSent) return;
  res
    .status(err.status || 500)
    .json({ message: err.message || "Internal server error" });
});

export default app;

