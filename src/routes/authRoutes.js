import { Router } from "express";
import { signup, login, googleCallback } from "../controllers/authController.js";
import passport from "passport";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);

router.get(
    "/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
    "/google/callback",
    passport.authenticate("google", { failureRedirect: "/login" }),
    googleCallback
);

export default router;
