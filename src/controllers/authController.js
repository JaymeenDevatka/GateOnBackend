import prisma from "../config/prismaClient.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/**
 * POST /api/auth/signup
 * Body: { name, email, password }
 * Creates user in DB with role = Attendee. Password is hashed and stored.
 */
export async function signup(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    if (!email || !email.trim()) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    const trimmedEmail = String(email).trim().toLowerCase();
    if (!trimmedEmail.includes("@")) {
      return res.status(400).json({ message: "Invalid email address" });
    }

    const existing = await prisma.user.findUnique({
      where: { email: trimmedEmail },
    });
    if (existing) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: name ? String(name).trim() || null : null,
        email: trimmedEmail,
        password: hashedPassword,
        role: "Attendee",
      },
    });

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    res.status(201).json({ user: safeUser });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Finds user by email, verifies password, and returns user.
 * Special: auto-seeds the admin account on first login with hardcoded credentials.
 */

// Hardcoded admin credentials (dev-only)
const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "admin@123";

export async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !String(email).trim()) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }
    const trimmedEmail = String(email).trim().toLowerCase();

    // Auto-seed admin account on first login attempt
    if (trimmedEmail === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      let adminUser = await prisma.user.findUnique({
        where: { email: ADMIN_EMAIL },
      });
      if (!adminUser) {
        const hashedAdminPw = await bcrypt.hash(ADMIN_PASSWORD, 10);
        adminUser = await prisma.user.create({
          data: {
            name: "System Admin",
            email: ADMIN_EMAIL,
            password: hashedAdminPw,
            role: "Admin",
            status: "active",
          },
        });
      }
    }

    const user = await prisma.user.findUnique({
      where: { email: trimmedEmail },
    });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Block banned/suspended users
    if (user.status === "banned") {
      return res.status(403).json({ message: "Your account has been banned. Contact support for assistance." });
    }
    if (user.status === "suspended") {
      return res.status(403).json({ message: "Your account has been suspended. Contact support for assistance." });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    };
    res.json({ user: safeUser });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/google/callback
 * Handles Google OAuth callback.
 * Redirects to frontend with JWT token.
 */
export async function googleCallback(req, res) {
  try {
    const user = req.user;
    if (!user) {
      return res.redirect("http://localhost:5173/login?error=auth_failed");
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Redirect to frontend with token
    res.redirect(`http://localhost:5173/auth/callback?token=${token}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Google auth error:", err);
    res.redirect("http://localhost:5173/login?error=server_error");
  }
}
