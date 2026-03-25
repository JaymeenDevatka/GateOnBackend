import { Router } from "express";
import { createOrder, verifyPayment, freeBooking } from "../controllers/paymentController.js";

const router = Router();

// Create a Razorpay order (called before opening the payment modal)
router.post("/create-order", createOrder);

// Verify Razorpay signature + create booking (called after modal success)
router.post("/verify", verifyPayment);

// Shortcut for free (₹0) events – skips Razorpay entirely
router.post("/free-booking", freeBooking);

export default router;
