import prisma from "../config/prismaClient.js";
import bcrypt from "bcryptjs";

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
 */
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

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    res.json({ user: safeUser });
  } catch (err) {
    next(err);
  }
}
