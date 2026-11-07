-- 0012 Import schedule (Task 4.10): the captures bucket also keeps an import's
-- original file (<user>/series/<series>/<name>): calendars, spreadsheets and text.
update storage.buckets
   set allowed_mime_types = array[
     'image/webp', 'image/jpeg', 'image/png', 'image/heic', 'application/pdf',
     'text/calendar', 'text/csv', 'text/plain',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-excel'
   ]
 where id = 'captures';
