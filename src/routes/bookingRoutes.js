import { Router } from "express";
import {
  listBookings,
  createBooking,
  cancelBooking,
  checkInBooking,
} from "../controllers/bookingController.js";

const router = Router();

router.get("/", listBookings);
router.post("/", createBooking);
router.post("/checkin", checkInBooking); // Check in by ticket code
router.post("/:id/cancel", cancelBooking);
router.post("/:id/checkin", checkInBooking); // Check in by booking ID (backward compat)

export default router;

