-- The picture beside an employee's name, cropped (owner's request, 16 October 2026: "allow me to crop the photo beside
-- the name to make the face bigger without affecting the uploaded full photo"): the square of a personal photo shown in
-- the circle, as fractions of the photo as shown ({ x, y, w, h }). Empty: the whole photo, centred, as before. The
-- uploaded file is never changed by it; replacing the file clears it.
ALTER TABLE "paperwork_items" ADD COLUMN "photo_crop" JSONB;
