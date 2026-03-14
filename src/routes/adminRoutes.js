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
} from "../controllers/adminController.js";

const router = Router();

// All admin routes require admin role
router.use(requireAdmin);

router.get("/stats", getStats);
router.get("/users", listUsers);
router.patch("/users/:id/status", updateUserStatus);
router.delete("/users/:id", deleteUser);
router.get("/events", listAllEvents);
router.delete("/events/:id", deleteEvent);
router.get("/bookings", listAllBookings);
router.get("/analytics", getAnalytics);

export default router;
