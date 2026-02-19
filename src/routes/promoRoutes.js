import { Router } from "express";
import {
  listPromos,
  createPromo,
  updatePromo,
} from "../controllers/promoController.js";

const router = Router();

router.get("/", listPromos);
router.post("/", createPromo);
router.patch("/:id", updatePromo);

export default router;

