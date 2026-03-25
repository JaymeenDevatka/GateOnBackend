import prisma from "../config/prismaClient.js";
import Razorpay from "razorpay";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/** Middleware: verify the caller is an Admin via X-User-Id header */
export async function requireAdmin(req, res, next) {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const user = await prisma.user.findUnique({ where: { id: String(userId) } });
    if (!user || user.role !== "Admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    req.adminUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/stats — dashboard overview statistics */
export async function getStats(req, res, next) {
  try {
    const [userCount, eventCount, bookingCount, revenueAgg, recentUsers, recentEvents] =
      await Promise.all([
        prisma.user.count(),
        prisma.event.count(),
        prisma.booking.count(),
        prisma.booking.aggregate({ _sum: { total: true }, where: { status: "confirmed" } }),
        prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, email: true, role: true, status: true, createdAt: true } }),
        prisma.event.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, status: true, ownerId: true, createdAt: true } }),
      ]);

    res.json({
      stats: {
        totalUsers: userCount,
        totalEvents: eventCount,
        totalBookings: bookingCount,
        totalRevenue: revenueAgg._sum.total || 0,
      },
      recentUsers,
      recentEvents,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/users — list all users */
export async function listUsers(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { events: true, bookings: true } },
      },
    });
    res.json({ items: users });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/users/:id/status — ban / suspend / activate a user */
export async function updateUserStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!["active", "suspended", "banned"].includes(status)) {
      return res.status(400).json({ message: "Status must be active, suspended, or banned" });
    }

    // Don't allow changing admin's own status
    if (id === req.adminUser.id) {
      return res.status(400).json({ message: "Cannot change your own status" });
    }

    const updated = await prisma.user.update({
      where: { id: String(id) },
      data: { status },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, updatedAt: true },
    });

    res.json(updated);
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ message: "User not found" });
    }
    next(err);
  }
}

/** DELETE /api/admin/users/:id — delete a user and all related records */
export async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;

    // Don't allow deleting your own admin account
    if (id === req.adminUser.id) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }

    // Check user exists
    const targetUser = await prisma.user.findUnique({ where: { id: String(id) } });
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Delete in proper order to satisfy foreign key constraints
    // 1. Delete bookings made by the user
    await prisma.booking.deleteMany({ where: { userId: String(id) } });

    // 2. Delete bookings, tickets, and events owned by the user
    const ownedEvents = await prisma.event.findMany({ where: { ownerId: String(id) }, select: { id: true } });
    const ownedEventIds = ownedEvents.map((e) => e.id);
    if (ownedEventIds.length > 0) {
      await prisma.booking.deleteMany({ where: { eventId: { in: ownedEventIds } } });
      await prisma.ticket.deleteMany({ where: { eventId: { in: ownedEventIds } } });
      await prisma.event.deleteMany({ where: { ownerId: String(id) } });
    }

    // 3. Delete the user
    await prisma.user.delete({ where: { id: String(id) } });

    res.json({ message: "User deleted successfully" });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ message: "User not found" });
    }
    next(err);
  }
}

/** GET /api/admin/events — list all events with owner info */
export async function listAllEvents(req, res, next) {
  try {
    const events = await prisma.event.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        tickets: true,
        _count: { select: { bookings: true } },
      },
    });
    res.json({ items: events });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/admin/events/:id — delete an event (and its tickets/bookings) */
export async function deleteEvent(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid event id" });
    }

    // Delete related records first (bookings → tickets → event)
    await prisma.booking.deleteMany({ where: { eventId: id } });
    await prisma.ticket.deleteMany({ where: { eventId: id } });
    await prisma.event.delete({ where: { id } });

    res.json({ message: "Event deleted successfully" });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ message: "Event not found" });
    }
    next(err);
  }
}

/** GET /api/admin/bookings — list all bookings with event and user info */
export async function listAllBookings(req, res, next) {
  try {
    const bookings = await prisma.booking.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { id: true, title: true } },
        user: { select: { id: true, name: true, email: true } },
        promo: true,
      },
    });
    res.json({ items: bookings });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/analytics — time-series data for charts */
export async function getAnalytics(req, res, next) {
  try {
    // Revenue by month (last 12 months, confirmed bookings only)
    const revenueByMonth = await prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon YYYY') AS month,
        DATE_TRUNC('month', "createdAt") AS sort_date,
        COALESCE(SUM("total"), 0)::int AS revenue,
        COUNT(*)::int AS count
      FROM "Booking"
      WHERE "createdAt" >= NOW() - INTERVAL '12 months'
        AND "status" = 'confirmed'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY sort_date ASC
    `;

    // Bookings by month (all statuses)
    const bookingsByMonth = await prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon YYYY') AS month,
        DATE_TRUNC('month', "createdAt") AS sort_date,
        COUNT(*)::int AS count
      FROM "Booking"
      WHERE "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY sort_date ASC
    `;

    // User signups by month
    const signupsByMonth = await prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon YYYY') AS month,
        DATE_TRUNC('month', "createdAt") AS sort_date,
        COUNT(*)::int AS count
      FROM "User"
      WHERE "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY sort_date ASC
    `;

    // Top 5 most popular events by booking count
    const popularEvents = await prisma.event.findMany({
      take: 5,
      orderBy: { bookings: { _count: "desc" } },
      select: {
        id: true,
        title: true,
        _count: { select: { bookings: true } },
      },
    });

    // Clean up sort_date from raw queries before sending
    const clean = (rows) => rows.map(({ sort_date, ...rest }) => rest);

    res.json({
      revenueByMonth: clean(revenueByMonth),
      bookingsByMonth: clean(bookingsByMonth),
      signupsByMonth: clean(signupsByMonth),
      popularEvents: popularEvents.map((e) => ({
        name: e.title.length > 25 ? e.title.slice(0, 25) + "…" : e.title,
        bookings: e._count.bookings,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/payments
 * Lists all payments with event, organizer, and booking info.
 * Supports ?status= filter (pending|paid|failed|refunded|distributed)
 */
export async function listAllPayments(req, res, next) {
  try {
    const where = {};
    if (req.query.status) {
      where.status = req.query.status;
    }

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { id: true, title: true } },
        organizer: { select: { id: true, name: true, email: true } },
        booking: {
          select: {
            id: true,
            ticketCode: true,
            attendeeName: true,
            attendeeEmail: true,
            total: true,
            status: true,
          },
        },
      },
    });

    // Add human-readable amount (convert paise → rupees)
    const items = payments.map((p) => ({
      ...p,
      amountRupees: p.amount / 100,
      distributedAmountRupees: p.distributedAmount ? p.distributedAmount / 100 : null,
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/payments/summary
 * Per-organizer revenue summary (for the "distribute" dashboard).
 * Returns total collected, total distributed, and pending amount per organizer.
 */
export async function getPaymentSummary(req, res, next) {
  try {
    // Aggregate by organizer using raw query for efficiency
    const rows = await prisma.$queryRaw`
      SELECT
        p."organizerId",
        u.name AS "organizerName",
        u.email AS "organizerEmail",
        COUNT(*)::int AS "paymentCount",
        COALESCE(SUM(CASE WHEN p.status = 'paid' OR p.status = 'distributed' THEN p.amount ELSE 0 END), 0)::int AS "totalCollectedPaise",
        COALESCE(SUM(CASE WHEN p.status = 'distributed' THEN p."distributedAmount" ELSE 0 END), 0)::int AS "totalDistributedPaise"
      FROM "Payment" p
      LEFT JOIN "User" u ON u.id = p."organizerId"
      WHERE p.status IN ('paid', 'distributed')
      GROUP BY p."organizerId", u.name, u.email
      ORDER BY "totalCollectedPaise" DESC
    `;

    const summary = rows.map((r) => ({
      organizerId: r.organizerId,
      organizerName: r.organizerName || "Unknown / Platform Event",
      organizerEmail: r.organizerEmail || "-",
      paymentCount: r.paymentCount,
      totalCollected: r.totalCollectedPaise / 100,
      totalDistributed: r.totalDistributedPaise / 100,
      pendingDistribution: (r.totalCollectedPaise - r.totalDistributedPaise) / 100,
    }));

    res.json({ summary });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/payments/:id/distribute
 * Records that the admin has manually transferred a share to the organizer.
 * This only records the distribution — the actual bank transfer is done
 * outside the platform (Razorpay dashboard, NEFT, UPI, etc.)
 *
 * Body: { amount: number (in rupees), note: string }
 */
export async function markDistributed(req, res, next) {
  try {
    const { id } = req.params;
    const { amount, note } = req.body || {};

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ message: "amount (in rupees) is required" });
    }

    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (payment.status !== "paid") {
      return res.status(400).json({ message: "Only 'paid' payments can be marked distributed" });
    }

    const updated = await prisma.payment.update({
      where: { id },
      data: {
        status: "distributed",
        distributedAmount: Math.round(Number(amount) * 100), // store in paise
        distributedAt: new Date(),
        distributionNote: note ? String(note).trim() : null,
      },
      include: {
        event: { select: { id: true, title: true } },
        organizer: { select: { id: true, name: true, email: true } },
        booking: { select: { id: true, ticketCode: true } },
      },
    });

    res.json({
      ...updated,
      amountRupees: updated.amount / 100,
      distributedAmountRupees: updated.distributedAmount / 100,
    });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ message: "Payment not found" });
    next(err);
  }
}

/**
 * POST /api/admin/payments/:id/refund
 * Issues a full refund via Razorpay for a paid booking.
 * Marks the Payment as 'refunded' and the linked Booking as 'cancelled'.
 */
export async function refundPayment(req, res, next) {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { booking: true },
    });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (payment.status !== "paid") {
      return res.status(400).json({ message: "Only 'paid' payments can be refunded" });
    }

    if (!payment.razorpayPaymentId) {
      return res.status(400).json({ message: "No Razorpay payment ID found – cannot issue refund" });
    }

    // Issue full refund via Razorpay API
    await razorpay.payments.refund(payment.razorpayPaymentId, {
      amount: payment.amount, // full refund
      notes: { reason: "Admin initiated refund", paymentDbId: id },
    });

    // Update records in a transaction
    const updates = [
      prisma.payment.update({
        where: { id },
        data: { status: "refunded" },
      }),
    ];
    if (payment.booking) {
      updates.push(
        prisma.booking.update({
          where: { id: payment.booking.id },
          data: { status: "cancelled" },
        })
      );
    }

    await prisma.$transaction(updates);

    res.json({ message: "Refund issued successfully", paymentId: id });
  } catch (err) {
    next(err);
  }
}