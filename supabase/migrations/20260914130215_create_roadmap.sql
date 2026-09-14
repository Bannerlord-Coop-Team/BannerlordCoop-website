create table public.roadmap_milestones (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    sort_order integer not null default 0
);

create table public.roadmap_items (
    id uuid primary key default gen_random_uuid(),
    milestone_id uuid not null references public.roadmap_milestones(id),
    title text not null,
    description text not null default '',
    status text not null check (status in ('completed', 'unstable', 'in_progress', 'planned')),
    sort_order integer not null default 0
);

alter table public.roadmap_milestones enable row level security;
alter table public.roadmap_items enable row level security;
revoke all on public.roadmap_milestones, public.roadmap_items from anon, authenticated;
grant select on public.roadmap_milestones, public.roadmap_items to anon, authenticated;
grant all on public.roadmap_milestones, public.roadmap_items to service_role;

create policy "Roadmap milestones are public"
    on public.roadmap_milestones for select to anon, authenticated using (true);
create policy "Roadmap items are public"
    on public.roadmap_items for select to anon, authenticated using (true);

with milestone as (
    insert into public.roadmap_milestones (title, sort_order)
    values ('v0.1', 10) returning id
)
insert into public.roadmap_items (milestone_id, title, description, status, sort_order)
select milestone.id, item.title, item.description, item.status, item.sort_order
from milestone cross join (values
    ('Player Movement', '', 'completed', 10),
    ('Map Encounters', '', 'completed', 20),
    ('Trading', '(Disabled for player to player)', 'completed', 30),
    ('Caravans', '', 'completed', 40),
    ('Villager Parties', '', 'completed', 50),
    ('AI Movement', '', 'completed', 60),
    ('Party Management', '', 'completed', 70),
    ('Player Captivity', '', 'completed', 80),
    ('Simulated Coop Battles', '', 'completed', 90),
    ('Steam Integration', '', 'completed', 100),
    ('Troop Recruitment', '', 'completed', 110),
    ('AI Battles', '', 'completed', 120),
    ('Settlement Management', '', 'completed', 130),
    ('Field Battles', '', 'completed', 140),
    ('Dedicated Server', '', 'completed', 150),
    ('Player gold', '', 'completed', 160),
    ('Smithy', '', 'completed', 170),
    ('Players visible in locations', '(taverns/town hall/etc...)', 'completed', 180),
    ('Kingdom Management', '', 'completed', 190),
    ('PVP', '', 'completed', 200),
    ('AI Party Creation', '', 'completed', 210),
    ('Character Management', '(Skills/etc...)', 'completed', 220),
    ('Clan Management', '', 'completed', 230)
) as item(title, description, status, sort_order);

with milestone as (
    insert into public.roadmap_milestones (title, sort_order)
    values ('v1.0', 20) returning id
)
insert into public.roadmap_items (milestone_id, title, description, status, sort_order)
select milestone.id, item.title, item.description, item.status, item.sort_order
from milestone cross join (values
    ('Arena', '', 'planned', 10),
    ('Linux Support', '', 'completed', 20),
    ('Player trading', '', 'completed', 30),
    ('Marriage & Death', '', 'planned', 40),
    ('Tournaments', '', 'completed', 50),
    ('Alleys', '', 'completed', 60),
    ('GamePass Support', '', 'in_progress', 70),
    ('Sieges', '', 'unstable', 80),
    ('Village Raids', '', 'completed', 90),
    ('Hideout', '', 'in_progress', 100),
    ('SallyOut', '', 'unstable', 110),
    ('Armies', '', 'unstable', 120)
) as item(title, description, status, sort_order);

with milestone as (
    insert into public.roadmap_milestones (title, sort_order)
    values ('v2.0', 30) returning id
)
insert into public.roadmap_items (milestone_id, title, description, status, sort_order)
select milestone.id, item.title, item.description, item.status, item.sort_order
from milestone cross join (values
    ('Warsails DLC', '', 'planned', 10),
    ('Quests', '', 'in_progress', 20)
) as item(title, description, status, sort_order);

with milestone as (
    insert into public.roadmap_milestones (title, sort_order)
    values ('v3.0', 40) returning id
)
insert into public.roadmap_items (milestone_id, title, description, status, sort_order)
select milestone.id, item.title, item.description, item.status, item.sort_order
from milestone cross join (values
    ('Mod Support', '', 'planned', 10),
    ('Localization', '', 'planned', 20)
) as item(title, description, status, sort_order);
