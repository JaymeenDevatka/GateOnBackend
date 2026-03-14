import prisma from "../config/prismaClient.js";

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
