/*
  Warnings:

  - A unique constraint covering the columns `[ticketCode]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `ticketCode` to the `Booking` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "ticketCode" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_ticketCode_key" ON "Booking"("ticketCode");
