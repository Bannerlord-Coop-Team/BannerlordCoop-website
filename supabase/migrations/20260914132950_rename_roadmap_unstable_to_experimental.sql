alter table public.roadmap_items drop constraint roadmap_items_status_check;
update public.roadmap_items set status = 'experimental' where status = 'unstable';
alter table public.roadmap_items add constraint roadmap_items_status_check
    check (status in ('completed', 'experimental', 'in_progress', 'planned'));
