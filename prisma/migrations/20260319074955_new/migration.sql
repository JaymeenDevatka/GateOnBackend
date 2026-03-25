-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "teamMembers" JSONB,
ADD COLUMN     "teamName" TEXT,
ADD COLUMN     "teamSize" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "maxTeamSize" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "participationType" TEXT NOT NULL DEFAULT 'solo';
