import prisma from "../config/prismaClient.js";

export async function computePricing({ eventId, ticketId, quantity, promoCode }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
  });

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  const unitPrice = ticket.price;
  const qty = Math.max(1, Math.min(5, Number(quantity) || 1));
  const baseTotal = unitPrice * qty;

  let promo = null;
  let promoDiscount = 0;

  if (promoCode) {
    const normalizedCode = String(promoCode).trim().toUpperCase();
    promo = await prisma.promoCode.findFirst({
      where: { code: normalizedCode, active: true },
    });

    if (promo) {
      if (promo.type === "percent") {
        promoDiscount = Math.round((baseTotal * promo.value) / 100);
      } else if (promo.type === "flat") {
        promoDiscount = Math.min(baseTotal, Math.round(promo.value));
      }
    }
  }

  const groupSets = qty >= 6 ? Math.floor(qty / 6) : 0;
  const groupDiscount = groupSets > 0 ? unitPrice * groupSets : 0;

  const discount = Math.min(baseTotal, promoDiscount + groupDiscount);
  const total = baseTotal - discount;

  return {
    unitPrice,
    quantity: qty,
    baseTotal,
    discount,
    groupDiscount,
    total,
    promo,
  };
}

