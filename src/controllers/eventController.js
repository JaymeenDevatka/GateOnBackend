import prisma from "../config/prismaClient.js";

/** Get current user id from header (frontend sends X-User-Id for authenticated requests) */
function getUserIdFromHeader(req) {
  const id = req.headers["x-user-id"];
  return id ? String(id).trim() || null : null;
}

function mapEventToApi(event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    date: event.date,
    location: event.location,
    venue: event.venue,
    venueType: event.venueType,
    category: event.category,
    sportType: event.sportType,
    trending: event.trending,
    rating: event.rating,
    status: event.status,
    ownerId: event.ownerId,
    price: event.price,
    tickets: (event.tickets || []).map((t) => ({
      id: t.id,
      name: t.name,
      label: t.name,
      price: t.price,
      maxQuantity: t.capacity,
      capacity: t.capacity,
    })),
  };
}

export async function listEvents(req, res, next) {
  try {
    const where = {};
    if (req.query.status) {
      where.status = req.query.status;
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { tickets: true },
    });

    res.json({ items: events.map(mapEventToApi) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/events/my-events — events where ownerId = current user (requires X-User-Id header) */
export async function listMyEvents(req, res, next) {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return res.status(401).json({ message: "User ID required" });
    }

    const events = await prisma.event.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "desc" },
      include: { tickets: true },
    });

    res.json({ items: events.map(mapEventToApi) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/events/browse — published events where ownerId != current user (X-User-Id optional) */
export async function listBrowseEvents(req, res, next) {
  try {
    const userId = getUserIdFromHeader(req);
    const where = { status: "published" };
    if (userId) {
      where.NOT = { ownerId: userId };
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { tickets: true },
    });

    res.json({ items: events.map(mapEventToApi) });
  } catch (err) {
    next(err);
  }
}

export async function getEvent(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid event id" });
    }

    const event = await prisma.event.findUnique({
      where: { id },
      include: { tickets: true },
    });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.json(mapEventToApi(event));
  } catch (err) {
    next(err);
  }
}

export async function createEvent(req, res, next) {
  try {
    const data = req.body || {};
    const userId = getUserIdFromHeader(req) || (data.ownerId ? String(data.ownerId).trim() : null);

    const ticketsInput = Array.isArray(data.tickets) ? data.tickets : [];
    const normalizedTickets = ticketsInput.map((t) => ({
      name: t.name || t.label || "Ticket",
      price: Number(t.price) || 0,
      capacity: Number(t.capacity ?? t.maxQuantity) || 0,
    }));

    const minTicketPrice =
      normalizedTickets.length > 0
        ? Math.min(...normalizedTickets.map((t) => t.price))
        : Number(data.price) || 0;

    let ownerId = null;
    if (userId) {
      const owner = await prisma.user.findUnique({
        where: { id: userId },
      });
      ownerId = owner ? owner.id : null;
    }

    const created = await prisma.event.create({
      data: {
        title: data.title,
        description: data.description || "",
        date: new Date(data.date),
        location: data.location || "",
        venue: data.venue || "",
        venueType: data.venueType || "",
        category: data.category || "",
        sportType: data.sportType || "",
        trending: Boolean(data.trending),
        rating: Number(data.rating) || 0,
        status: data.status || "published",
        ownerId,
        price: minTicketPrice,
        tickets: {
          create: normalizedTickets,
        },
      },
      include: { tickets: true },
    });

    if (ownerId) {
      await prisma.user.update({
        where: { id: ownerId },
        data: { role: "EventManager" },
      });
    }

    res.status(201).json(mapEventToApi(created));
  } catch (err) {
    next(err);
  }
}

export async function updateEvent(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid event id" });
    }

    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return res.status(401).json({ message: "User ID required" });
    }

    const existing = await prisma.event.findUnique({
      where: { id },
      include: { tickets: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existing.ownerId !== userId) {
      return res.status(403).json({ message: "You can only edit your own events" });
    }

    const data = req.body || {};
    const ticketsInput = Array.isArray(data.tickets) ? data.tickets : [];
    const normalizedTickets = ticketsInput.map((t) => ({
      name: t.name || t.label || "Ticket",
      price: Number(t.price) || 0,
      capacity: Number(t.capacity ?? t.maxQuantity) || 0,
    }));

    const minTicketPrice =
      normalizedTickets.length > 0
        ? Math.min(...normalizedTickets.map((t) => t.price))
        : Number(data.price) ?? existing.price;

    // Delete existing tickets and create new ones
    await prisma.ticket.deleteMany({
      where: { eventId: id },
    });

    const updated = await prisma.event.update({
      where: { id },
      data: {
        title: data.title ?? existing.title,
        description: data.description ?? existing.description,
        date: data.date ? new Date(data.date) : existing.date,
        location: data.location ?? existing.location,
        venue: data.venue ?? existing.venue,
        venueType: data.venueType ?? existing.venueType,
        category: data.category ?? existing.category,
        sportType: data.sportType ?? existing.sportType,
        trending: data.trending !== undefined ? Boolean(data.trending) : existing.trending,
        rating: data.rating !== undefined ? Number(data.rating) : existing.rating,
        status: data.status ?? existing.status,
        price: minTicketPrice,
        tickets: {
          create: normalizedTickets,
        },
      },
      include: { tickets: true },
    });

    res.json(mapEventToApi(updated));
  } catch (err) {
    next(err);
  }
}

