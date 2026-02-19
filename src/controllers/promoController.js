import prisma from "../config/prismaClient.js";

function mapPromoToApi(promo) {
  return {
    id: promo.id,
    code: promo.code,
    type: promo.type,
    value: promo.value,
    active: promo.active,
    createdAt: promo.createdAt,
    updatedAt: promo.updatedAt,
  };
}

export async function listPromos(req, res, next) {
  try {
    const promos = await prisma.promoCode.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ items: promos.map(mapPromoToApi) });
  } catch (err) {
    next(err);
  }
}

export async function createPromo(req, res, next) {
  try {
    const { code, type, value, active = true } = req.body || {};

    if (!code || !type || typeof value === "undefined") {
      return res.status(400).json({ message: "Invalid promo payload" });
    }

    const normalizedCode = String(code).trim().toUpperCase();

    const created = await prisma.promoCode.create({
      data: {
        code: normalizedCode,
        type,
        value: Number(value) || 0,
        active: Boolean(active),
      },
    });

    res.status(201).json(mapPromoToApi(created));
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ message: "Promo code already exists" });
    }
    next(err);
  }
}

export async function updatePromo(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid promo id" });
    }

    const data = {};
    if (typeof req.body.active !== "undefined") {
      data.active = Boolean(req.body.active);
    }
    if (req.body.type) data.type = req.body.type;
    if (typeof req.body.value !== "undefined") {
      data.value = Number(req.body.value) || 0;
    }

    const updated = await prisma.promoCode.update({
      where: { id },
      data,
    });

    res.json(mapPromoToApi(updated));
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ message: "Promo not found" });
    }
    next(err);
  }
}

