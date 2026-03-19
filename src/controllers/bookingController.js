import prisma from "../config/prismaClient.js";
import { computePricing } from "../services/pricingService.js";
import { generateQR } from "../services/qrCodeService.js";
import { sendTicketEmail } from "../services/emailService.js";

function generateTicketCode(eventId) {
  const eventPart = String(eventId).padStart(4, "0");
  const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `EVT-${eventPart}-${randomPart}`;
}

async function ensureUniqueTicketCode(eventId) {
  let ticketCode = generateTicketCode(eventId);
  let exists = await prisma.booking.findUnique({
    where: { ticketCode },
  });
  let attempts = 0;
  while (exists && attempts < 10) {
    ticketCode = generateTicketCode(eventId);
    exists = await prisma.booking.findUnique({
      where: { ticketCode },
    });
    attempts++;
  }
  return ticketCode;
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
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

export async function listBookings(req, res, next) {
  try {
    const where = {};
    if (req.query.userId) {
      where.userId = String(req.query.userId);
    }
    if (req.query.eventId) {
      where.eventId = Number(req.query.eventId);
    }

    const bookings = await prisma.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { promo: true },
    });

    res.json({ items: bookings.map(mapBookingToApi) });
  } catch (err) {
    next(err);
  }
}

export async function createBooking(req, res, next) {
  try {
    const { eventId, ticketId, quantity, userId, attendee, promoCode, delivery, teamName, teamSize, teamMembers } =
      req.body || {};

    if (!eventId || !ticketId || !attendee) {
      return res.status(400).json({ message: "Missing event/ticket/attendee" });
    }

    const eventIdNum = Number(eventId);
    const ticketIdNum = Number(ticketId);
    const qty = Math.max(1, Number(quantity) || 1);

    // Check ticket capacity
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketIdNum },
      include: {
        bookings: {
          where: { status: "confirmed" },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    // For team events: validate teamSize and teamMembers
    const event = await prisma.event.findUnique({ where: { id: eventIdNum } });
    const isTeamEvent = event?.participationType === "team";
    const parsedTeamSize = Math.max(1, Number(teamSize) || 1);
    if (isTeamEvent) {
      if (!teamName || !String(teamName).trim()) {
        return res.status(400).json({ message: "Team name is required for team events" });
      }
      if (parsedTeamSize > (event.maxTeamSize || 1)) {
        return res.status(400).json({
          message: `Team size cannot exceed the maximum of ${event.maxTeamSize} members`,
        });
      }
      // Validate teamMembers array
      if (!Array.isArray(teamMembers) || teamMembers.length !== parsedTeamSize) {
        return res.status(400).json({
          message: `Please provide details for all ${parsedTeamSize} team members`,
        });
      }
      for (let i = 0; i < teamMembers.length; i++) {
        const m = teamMembers[i];
        if (!m.name || !String(m.name).trim()) {
          return res.status(400).json({ message: `Name is required for member ${i + 1}` });
        }
        if (!m.email || !String(m.email).includes("@")) {
          return res.status(400).json({ message: `Valid email is required for member ${i + 1}` });
        }
      }
    }

    const soldCount = ticket.bookings.reduce((sum, b) => sum + b.quantity, 0);
    const available = ticket.capacity - soldCount;

    if (qty > available) {
      return res.status(400).json({
        message: `Only ${available} ticket(s) available. Requested: ${qty}`,
      });
    }

    const pricing = await computePricing({
      eventId: eventIdNum,
      ticketId: ticketIdNum,
      quantity: qty,
      promoCode,
    });

    const fullName =
      `${attendee?.name || attendee?.firstName || ""} ${
        attendee?.lastName || ""
      }`.trim() || "Attendee";

    let promo = null;
    if (promoCode) {
      const normalizedCode = String(promoCode).trim().toUpperCase();
      promo = await prisma.promoCode.findFirst({
        where: { code: normalizedCode, active: true },
      });
    }

    // Validate userId if provided - set to null if user doesn't exist
    let validatedUserId = null;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: String(userId) },
      });
      validatedUserId = user ? user.id : null;

      // Prevent multiple bookings per user
      if (validatedUserId) {
        const existingBooking = await prisma.booking.findFirst({
          where: {
            userId: validatedUserId,
            eventId: eventIdNum,
            status: { not: "cancelled" },
          },
        });

        if (existingBooking) {
          return res.status(400).json({ 
            message: "You have already booked a ticket for this event. Multiple bookings are not allowed." 
          });
        }
      }
    }

    // Generate unique ticket code
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
        total: pricing.total,
        promoCodeId: promo ? promo.id : null,
        status: "confirmed",
        teamName: isTeamEvent ? String(teamName).trim() : null,
        teamSize: isTeamEvent ? parsedTeamSize : 1,
        teamMembers: isTeamEvent && Array.isArray(teamMembers)
          ? teamMembers.map((m) => ({ name: String(m.name).trim(), email: String(m.email).trim(), phone: m.phone ? String(m.phone).trim() : "" }))
          : null,
      },
      include: { promo: true },
    });

    // Send the email ticket asynchronously
    generateQR(ticketCode).then((qrDataUrl) => {
      if (qrDataUrl) {
        sendTicketEmail(created, event, qrDataUrl);
      }
    });

    res.status(201).json(mapBookingToApi(created));
  } catch (err) {
    next(err);
  }
}

export async function cancelBooking(req, res, next) {
  try {
    const id = String(req.params.id);

    const updated = await prisma.booking.update({
      where: { id },
      data: { status: "cancelled" },
      include: { promo: true },
    });

    res.json(mapBookingToApi(updated));
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ message: "Booking not found" });
    }
    next(err);
  }
}

export async function checkInBooking(req, res, next) {
  try {
    const id = String(req.params.id);
    const ticketCode = req.body?.ticketCode || req.query?.ticketCode;

    let existing = null;
    if (ticketCode) {
      // Check in by ticket code
      existing = await prisma.booking.findUnique({
        where: { ticketCode: String(ticketCode).trim().toUpperCase() },
        include: { promo: true, event: true },
      });
    } else {
      // Check in by booking ID (backward compatibility)
      existing = await prisma.booking.findUnique({
        where: { id },
        include: { promo: true, event: true },
      });
    }

    if (!existing) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (existing.checkedInAt) {
      return res
        .status(400)
        .json({ message: "This ticket has already been checked in." });
    }

    if (existing.status !== "confirmed") {
      return res.status(400).json({ message: "Only confirmed tickets can be checked in." });
    }

    const updated = await prisma.booking.update({
      where: { id: existing.id },
      data: { checkedInAt: new Date() },
      include: { promo: true, event: true },
    });

    res.json(mapBookingToApi(updated));
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ message: "Ticket not found" });
    }
    next(err);
  }
}

