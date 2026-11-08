-- Tests for link reading: the read trigger and summaries applied by apply_sort_batch v2.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role)
values ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

select has_trigger('public', 'captures', 'request_link_read', 'link captures ask read-link to read the page');
select lives_ok($$ insert into public.captures (user_id, kind, url, status)
  values ('00000000-0000-0000-0000-00000000000a', 'link', 'https://example.com/x', 'sorted') $$,
  'inserting a link capture without Vault secrets is fine (no request made)');

-- A saved page waiting for its summary, with its reading item
insert into public.captures (id, user_id, kind, url, status, payload) values
  ('c0000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-00000000000a', 'link',
   'https://marathon.example/expo', 'sorted',
   '{"summary_pending": true, "article_text": "Race pack collection...", "link": {"status": "read"}}');
insert into public.items (id, user_id, capture_id, type, title, data) values
  ('10000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-00000000000a',
   'c0000000-0000-4000-8000-0000000000e1', 'reading', 'Dublin Marathon Expo 2027', '{"url": "https://marathon.example/expo"}');
-- An already-summarised page (must not be touched again)
insert into public.captures (id, user_id, kind, url, status, payload) values
  ('c0000000-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-00000000000a', 'link',
   'https://old.example/', 'sorted', '{"summary_pending": false}');

select is(
  public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {
    "captures": [],
    "new_topics": ["Running"],
    "link_captures": ["c0000000-0000-4000-8000-0000000000e1", "c0000000-0000-4000-8000-0000000000e2"],
    "items": [
      {"capture_id": "c0000000-0000-4000-8000-0000000000e1", "type": "event", "title": "Dublin Marathon Expo",
       "body": null, "status": "suggested", "start_at": "2027-10-22T09:00:00.000Z", "end_at": null,
       "all_day": false, "due_at": null, "rrule": null, "calendar": "personal", "list_id": null,
       "topic_names": ["Running"], "confidence": 0.9, "data": {"from_link": true}},
      {"capture_id": "c0000000-0000-4000-8000-0000000000e2", "type": "task", "title": "Should not appear",
       "body": null, "status": "suggested", "start_at": null, "end_at": null, "all_day": false,
       "due_at": null, "rrule": null, "calendar": null, "list_id": null, "topic_names": [],
       "confidence": 0.9, "data": {}}
    ],
    "reading_updates": [
      {"capture_id": "c0000000-0000-4000-8000-0000000000e1", "summary": "The expo runs on 22-23 October.",
       "key_points": ["Bring photo ID"], "topic_names": ["Running"]}
    ]
  }
  $json$::jsonb),
  '{"items": 1, "captures": 0, "links": 1, "actions": 0}'::jsonb,
  'applies only to pages still waiting for a summary');

select is((select data ->> 'summary' from public.items where id = '10000000-0000-4000-8000-0000000000e1'),
  'The expo runs on 22-23 October.', 'summary written to the reading item');
select is((select data -> 'key_points' from public.items where id = '10000000-0000-4000-8000-0000000000e1'),
  '["Bring photo ID"]'::jsonb, 'key points written');
select is((select data ->> 'url' from public.items where id = '10000000-0000-4000-8000-0000000000e1'),
  'https://marathon.example/expo', 'existing item data kept');
select ok((select array_length(topic_ids, 1) = 1 from public.items where id = '10000000-0000-4000-8000-0000000000e1'),
  'topic attached to the reading item');
select is((select status from public.items where title = 'Dublin Marathon Expo'), 'suggested',
  'the action from the page is a suggestion');
select ok((select not (payload ? 'article_text') and payload ->> 'summary_pending' = 'false'
           from public.captures where id = 'c0000000-0000-4000-8000-0000000000e1'),
  'the stored page text is cleared and the flag reset');
select is((select status from public.captures where id = 'c0000000-0000-4000-8000-0000000000e1'), 'sorted',
  'the link capture keeps its status');
select is((select count(*)::int from public.items where title = 'Should not appear'), 0,
  'pages not waiting for a summary are left alone');

select * from finish();
rollback;
