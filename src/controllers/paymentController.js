/**
 * paymentController.js
 *
 * All event payments flow to the single admin Razorpay account.
 * Admin then distributes to organizers manually via the admin dashboard.
 *
 * Flow:
 *   1. POST /api/payments/create-order  → creates a Razorpay order + a pending Payment row
 *   2. Frontend opens Razorpay modal    → user pays (money hits admin's Razorpay account)
 *   3. POST /api/payments/verify        → verifies HMAC signature, creates Booking, marks Payment paid
 */

import Razorpay from "razorpay";
import crypto from "crypto";
import prisma from "../config/prismaClient.js";
import { computePricing } from "../services/pricingService.js";
import { generateQR } from "../services/qrCodeService.js";
import { sendTicketEmail } from "../services/emailService.js";

// ── Razorpay client (uses admin credentials from .env) ──────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── helpers ──────────────────────────────────────────────────────────────────
function generateTicketCode(eventId) {
  const eventPart = String(eventId).padStart(4, "0");
  const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `EVT-${eventPart}-${randomPart}`;
}

async function ensureUniqueTicketCode(eventId) {
  let code = generateTicketCode(eventId);
  let exists = await prisma.booking.findUnique({ where: { ticketCode: code } });
  let attempts = 0;
  while (exists && attempts < 10) {
    code = generateTicketCode(eventId);
    exists = await prisma.booking.findUnique({ where: { ticketCode: code } });
    attempts++;
  }
  return code;
}

function mapBookingToApi(booking) {
  return {
    id: booking.id,
    ticketCode: booking.ticketCode,
    userId: booking.userId,
    eventId: booking.eventId,
    ticketId: booking.ticketId,
    quantity: booking.quantity,
    attendee: {
      name: booking.attendeeName,
      email: booking.attendeeEmail,
      phone: booking.attendeePhone || "",
    },
    unitPrice: booking.unitPrice,
    subtotal: booking.subtotal,
    discount: booking.discount,
    groupDiscount: booking.groupDiscount,
    total: booking.total,
    promoCode: booking.promo ? booking.promo.code : null,
    delivery: booking.delivery,
    status: booking.status,
    checkedInAt: booking.checkedInAt,
    teamName: booking.teamName || null,
    teamSize: booking.teamSize ?? 1,
    teamMembers: booking.teamMembers || null,
    paymentId: booking.paymentId || null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

// ── POST /api/payments/create-order ──────────────────────────────────────────
/**
 * Creates a Razorpay order and stores a pending Payment row in the DB.
 * Returns the orderId + public key so the frontend can open the modal.
 *
 * Body: { eventId, ticketId, quantity, promoCode? }
 */
export async function createOrder(req, res, next) {
  try {
    const { eventId, ticketId, quantity, promoCode } = req.body || {};

    if (!eventId || !ticketId) {
      return res.status(400).json({ message: "eventId and ticketId are required" });
    }

    const eventIdNum = Number(eventId);
    const ticketIdNum = Number(ticketId);
    const qty = Math.max(1, Number(quantity) || 1);

    // Verify event + ticket exist
    const event = await prisma.event.findUnique({ where: { id: eventIdNum } });
    if (!event) return res.status(404).json({ message: "Event not found" });

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketIdNum } });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    // Compute final price (with any promo discount applied)
    const pricing = await computePricing({
      eventId: eventIdNum,
      ticketId: ticketIdNum,
      quantity: qty,
      promoCode,
    });

    // Free events skip Razorpay entirely
    if (pricing.total === 0) {
      return res.json({
        free: true,
        amount: 0,
        pricing,
      });
    }

    // Amount in paise (Razorpay uses smallest currency unit)
    const amountInPaise = pricing.total * 100;

    // Create order in Razorpay (money will land in admin's Razorpay account)
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `gateon_evt${eventIdNum}_${Date.now()}`,
      notes: {
        eventId: String(eventIdNum),
        eventTitle: event.title,
        ticketId: String(ticketIdNum),
      },
    });

    // Store pending Payment record so we can reconcile after the modal callback
    const payment = await prisma.payment.create({
      data: {
        razorpayOrderId: razorpayOrder.id,
        amount: amountInPaise,
        currency: "INR",
        status: "pending",
        eventId: eventIdNum,
        organizerId: event.ownerId || null,
      },
    });

    return res.json({
      free: false,
      orderId: razorpayOrder.id,   // frontend passes this to Razorpay modal
      amount: amountInPaise,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID, // public key – safe to send
      paymentDbId: payment.id,            // our internal ID for linking later
      pricing,
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/payments/verify ─────────────────────────────────────────────────
/**
 * Called after Razorpay modal succeeds.
 * 1. Verifies the HMAC signature  (prevents payment bypass / tampering)
 * 2. Creates the Booking record
 * 3. Marks the Payment as "paid" and links it to the Booking
 * 4. Sends ticket email
 *
 * Body: {
 *   razorpayOrderId, razorpayPaymentId, razorpaySignature,
 *   paymentDbId,
 *   // booking data (same fields as createBooking)
 *   eventId, ticketId, quantity, userId?, attendee, promoCode?, delivery,
 *   teamName?, teamSize?, teamMembers?
 * }
 */
export async function verifyPayment(req, res, next) {
  try {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      paymentDbId,
      // booking fields
      eventId,
      ticketId,
      quantity,
      userId,
      attendee,
      promoCode,
      delivery,
      teamName,
      teamSize,
      teamMembers,
    } = req.body || {};

    // ── 1. Validate required payment fields ────────────────────────────────
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !paymentDbId) {
      return res.status(400).json({ message: "Missing payment verification fields" });
    }

    // ── 2. Verify HMAC-SHA256 signature ────────────────────────────────────
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (generatedSignature !== razorpaySignature) {
      // Mark payment as failed
      await prisma.payment.update({
        where: { id: paymentDbId },
        data: { status: "failed", razorpayPaymentId, razorpaySignature },
      });
      return res.status(400).json({ message: "Payment verification failed. Please contact support." });
    }

    // ── 3. Validate booking fields ─────────────────────────────────────────
    if (!eventId || !ticketId || !attendee) {
      return res.status(400).json({ message: "Missing booking fields" });
    }

    const eventIdNum = Number(eventId);
    const ticketIdNum = Number(ticketId);
    const qty = Math.max(1, Number(quantity) || 1);

    // Check ticket capacity
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketIdNum },
      include: { bookings: { where: { status: "confirmed" } } },
    });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const event = await prisma.event.findUnique({ where: { id: eventIdNum } });
    if (!event) return res.status(404).json({ message: "Event not found" });

    const soldCount = ticket.bookings.reduce((sum, b) => sum + b.quantity, 0);
    const available = ticket.capacity - soldCount;
    if (qty > available) {
      return res.status(400).json({ message: `Only ${available} ticket(s) available` });
    }

    // Team event validation
    const isTeamEvent = event.participationType === "team";
    const parsedTeamSize = Math.max(1, Number(teamSize) || 1);
    if (isTeamEvent) {
      if (!teamName?.trim()) return res.status(400).json({ message: "Team name is required" });
      if (parsedTeamSize > (event.maxTeamSize || 1)) {
        return res.status(400).json({ message: `Team size cannot exceed ${event.maxTeamSize}` });
      }
      if (!Array.isArray(teamMembers) || teamMembers.length !== parsedTeamSize) {
        return res.status(400).json({ message: `Provide details for all ${parsedTeamSize} team members` });
      }
    }

    // Validate userId – prevent duplicate bookings
    let validatedUserId = null;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: String(userId) } });
      validatedUserId = user ? user.id : null;
      if (validatedUserId) {
        const existing = await prisma.booking.findFirst({
          where: { userId: validatedUserId, eventId: eventIdNum, status: { not: "cancelled" } },
        });
        if (existing) {
          return res.status(400).json({ message: "You have already booked a ticket for this event." });
        }
      }
    }

    // Compute pricing (again, to build the stored values)
    const pricing = await computePricing({ eventId: eventIdNum, ticketId: ticketIdNum, quantity: qty, promoCode });

    // Resolve promo
    let promo = null;
    if (promoCode) {
      const normalizedCode = String(promoCode).trim().toUpperCase();
      promo = await prisma.promoCode.findFirst({ where: { code: normalizedCode, active: true } });
    }

    const fullName = `${attendee?.name || attendee?.firstName || ""} ${attendee?.lastName || ""}`.trim() || "Attendee";
    const ticketCode = await ensureUniqueTicketCode(eventIdNum);

    // ── 4. Create Booking + mark Payment paid (in a transaction) ───────────
    const [booking] = await prisma.$transaction([
      prisma.booking.create({
        data: {
          ticketCode,
          userId: validatedUserId,
          eventId: eventIdNum,
          ticketId: ticketIdNum,
          quantity: qty,
          attendeeName: fullName,
          attendeeEmail: attendee.email || "",
          attendeePhone: attendee.phone || "",
          delivery: delivery === "whatsapp" ? "whatsapp" : "email",
          unitPrice: pricing.unitPrice,
          subtotal: pricing.baseTotal,
          discount: pricing.discount,
          groupDiscount: pricing.groupDiscount,
          total: pricing.total,
          promoCodeId: promo ? promo.id : null,
          status: "confirmed",
          paymentId: paymentDbId,
          teamName: isTeamEvent ? String(teamName).trim() : null,
          teamSize: isTeamEvent ? parsedTeamSize : 1,
          teamMembers:
            isTeamEvent && Array.isArray(teamMembers)
              ? teamMembers.map((m) => ({
                  name: String(m.name).trim(),
                  email: String(m.email).trim(),
                  phone: m.phone ? String(m.phone).trim() : "",
                }))
              : null,
        },
        include: { promo: true },
      }),
      prisma.payment.update({
        where: { id: paymentDbId },
        data: {
          razorpayPaymentId,
          razorpaySignature,
          status: "paid",
        },
      }),
    ]);

    // ── 5. Send ticket email (async, don't block response) ─────────────────
    generateQR(ticketCode).then((qrDataUrl) => {
      if (qrDataUrl) sendTicketEmail(booking, event, qrDataUrl);
    });

    return res.status(201).json(mapBookingToApi(booking));
  } catch (err) {
    next(err);
  }
}

// ── POST /api/payments/free-booking ──────────────────────────────────────────
/**
 * Creates a booking for a free (₹0) event, skipping Razorpay entirely.
 * Reuses the same booking logic but no payment record is created.
 */
export async function freeBooking(req, res, next) {
  try {
    const {
      eventId, ticketId, quantity, userId, attendee,
      promoCode, delivery, teamName, teamSize, teamMembers,
    } = req.body || {};

    if (!eventId || !ticketId || !attendee) {
      return res.status(400).json({ message: "Missing event/ticket/attendee" });
    }

    const eventIdNum = Number(eventId);
    const ticketIdNum = Number(ticketId);
    const qty = Math.max(1, Number(quantity) || 1);

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketIdNum },
      include: { bookings: { where: { status: "confirmed" } } },
    });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const event = await prisma.event.findUnique({ where: { id: eventIdNum } });
    if (!event) return res.status(404).json({ message: "Event not found" });

    const pricing = await computePricing({ eventId: eventIdNum, ticketId: ticketIdNum, quantity: qty, promoCode });

    // Safety check – reject if price is not actually 0
    if (pricing.total > 0) {
      return res.status(400).json({ message: "This event requires payment. Please use the payment flow." });
    }

    const soldCount = ticket.bookings.reduce((sum, b) => sum + b.quantity, 0);
    const available = ticket.capacity - soldCount;
    if (qty > available) return res.status(400).json({ message: `Only ${available} ticket(s) available` });

    const isTeamEvent = event.participationType === "team";
    const parsedTeamSize = Math.max(1, Number(teamSize) || 1);

    let validatedUserId = null;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: String(userId) } });
      validatedUserId = user ? user.id : null;
      if (validatedUserId) {
        const existing = await prisma.booking.findFirst({
          where: { userId: validatedUserId, eventId: eventIdNum, status: { not: "cancelled" } },
        });
        if (existing) return res.status(400).json({ message: "You have already booked this event." });
      }
    }

    let promo = null;
    if (promoCode) {
      const code = String(promoCode).trim().toUpperCase();
      promo = await prisma.promoCode.findFirst({ where: { code, active: true } });
    }

    const fullName = `${attendee?.name || attendee?.firstName || ""} ${attendee?.lastName || ""}`.trim() || "Attendee";
    const ticketCode = await ensureUniqueTicketCode(eventIdNum);

    const created = await prisma.booking.create({
      data: {
        ticketCode,
        userId: validatedUserId,
        eventId: eventIdNum,
        ticketId: ticketIdNum,
        quantity: qty,
        attendeeName: fullName,
        attendeeEmail: attendee.email || "",
        attendeePhone: attendee.phone || "",
        delivery: delivery === "whatsapp" ? "whatsapp" : "email",
        unitPrice: pricing.unitPrice,
        subtotal: pricing.baseTotal,
        discount: pricing.discount,
        groupDiscount: pricing.groupDiscount,
        total: 0,
        promoCodeId: promo ? promo.id : null,
        status: "confirmed",
        paymentId: null,
        teamName: isTeamEvent ? String(teamName).trim() : null,
        teamSize: isTeamEvent ? parsedTeamSize : 1,
        teamMembers: isTeamEvent && Array.isArray(teamMembers)
          ? teamMembers.map((m) => ({ name: String(m.name).trim(), email: String(m.email).trim(), phone: m.phone || "" }))
          : null,
      },
      include: { promo: true },
    });

    generateQR(ticketCode).then((qrDataUrl) => {
      if (qrDataUrl) sendTicketEmail(created, event, qrDataUrl);
    });

    return res.status(201).json(mapBookingToApi(created));
  } catch (err) {
    next(err);
  }
}
