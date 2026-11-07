-- Tests for migration 0012: import files allowed in the private captures bucket.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select ok((select allowed_mime_types @> array['text/calendar', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'application/pdf']
  from storage.buckets where id = 'captures'), 'import file types are allowed');
select ok((select not public from storage.buckets where id = 'captures'), 'the bucket is still private');
select ok(not (select allowed_mime_types @> array['text/html'] from storage.buckets where id = 'captures'),
  'web pages are still not stored');

select * from finish();
rollback;
