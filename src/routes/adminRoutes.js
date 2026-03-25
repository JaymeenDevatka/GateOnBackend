import { Router } from "express";
import {
    requireAdmin,
    getStats,
    listUsers,
    updateUserStatus,
    deleteUser,
    listAllEvents,
    deleteEvent,
    listAllBookings,
    getAnalytics,
    listAllPayments,
    getPaymentSummary,
    markDistributed,
    refundPayment,
} from "../controllers/adminController.js";

const router = Router();

// All admin routes require the admin middleware
router.use(requireAdmin);

// ── Existing routes ────────────────────────────────────────────────────────
router.get("/stats", getStats);
router.get("/analytics", getAnalytics);

router.get("/users", listUsers);
router.patch("/users/:id/status", updateUserStatus);
router.delete("/users/:id", deleteUser);

router.get("/events", listAllEvents);
router.delete("/events/:id", deleteEvent);

router.get("/bookings", listAllBookings);

// ── NEW: Payment management routes ────────────────────────────────────────
// GET    /api/admin/payments              – list all payments (filterable by status)
// GET    /api/admin/payments/summary      – per-organizer revenue summary
// POST   /api/admin/payments/:id/distribute – record admin→organizer distribution
// POST   /api/admin/payments/:id/refund   – issue full Razorpay refund
router.get("/payments", listAllPayments);
router.get("/payments/summary", getPaymentSummary);
router.post("/payments/:id/distribute", markDistributed);
router.post("/payments/:id/refund", refundPayment);

export default router;
