import { Router } from "express";
import {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  listMyEvents,
  listBrowseEvents,
} from "../controllers/eventController.js";

const router = Router();

router.get("/", listEvents);
router.get("/my-events", listMyEvents);
router.get("/browse", listBrowseEvents);
router.get("/:id", getEvent);
router.post("/", createEvent);
router.put("/:id", updateEvent);
router.patch("/:id", updateEvent);

export default router;

