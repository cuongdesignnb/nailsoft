import pg from "pg";
const db = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
await db.connect();
const tenant = "10000000-0000-4000-8000-000000000001";
try {
  if (process.argv[2] === "clean") {
    await db.query(
      `BEGIN;ALTER TABLE services DISABLE TRIGGER availability_bump_services;ALTER TABLE staff_branch_assignments DISABLE TRIGGER availability_bump_staff_assignments;ALTER TABLE shifts DISABLE TRIGGER availability_bump_shifts;ALTER TABLE leave_requests DISABLE TRIGGER availability_bump_leave;ALTER TABLE resources DISABLE TRIGGER availability_bump_resources;ALTER TABLE availability_blocks DISABLE TRIGGER availability_bump_blocks;ALTER TABLE branches DISABLE TRIGGER availability_bump_branches;DELETE FROM availability_blocks WHERE title LIKE 'PERF-%';DELETE FROM shifts WHERE source='IMPORT' AND created_by_user_id IS NULL;DELETE FROM leave_requests WHERE reason='PERF-S3';DELETE FROM staff_branch_assignments WHERE staff_id IN(SELECT id FROM staff_profiles WHERE employee_code LIKE 'PERF-%');DELETE FROM staff_profiles WHERE employee_code LIKE 'PERF-%';DELETE FROM resources WHERE code LIKE 'PERF-%';DELETE FROM services WHERE code LIKE 'PERF-%';DELETE FROM business_hours WHERE branch_id IN(SELECT id FROM branches WHERE code LIKE 'PERF-%');DELETE FROM branch_settings WHERE branch_id IN(SELECT id FROM branches WHERE code LIKE 'PERF-%');DELETE FROM branches WHERE code LIKE 'PERF-%';ALTER TABLE services ENABLE TRIGGER availability_bump_services;ALTER TABLE staff_branch_assignments ENABLE TRIGGER availability_bump_staff_assignments;ALTER TABLE shifts ENABLE TRIGGER availability_bump_shifts;ALTER TABLE leave_requests ENABLE TRIGGER availability_bump_leave;ALTER TABLE resources ENABLE TRIGGER availability_bump_resources;ALTER TABLE availability_blocks ENABLE TRIGGER availability_bump_blocks;ALTER TABLE branches ENABLE TRIGGER availability_bump_branches;UPDATE availability_versions SET version=version+1,updated_at=now() WHERE tenant_id='${tenant}';COMMIT`,
    );
    console.log("Sprint 3 capacity fixture removed");
  } else {
    await db.query(`BEGIN;
ALTER TABLE services DISABLE TRIGGER availability_bump_services;ALTER TABLE staff_branch_assignments DISABLE TRIGGER availability_bump_staff_assignments;ALTER TABLE shifts DISABLE TRIGGER availability_bump_shifts;ALTER TABLE leave_requests DISABLE TRIGGER availability_bump_leave;ALTER TABLE resources DISABLE TRIGGER availability_bump_resources;ALTER TABLE availability_blocks DISABLE TRIGGER availability_bump_blocks;ALTER TABLE availability_blocks DISABLE TRIGGER availability_block_target_guard;
INSERT INTO branches(id,tenant_id,name,code,timezone) SELECT ('b7000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${tenant}','Performance branch '||g,'PERF-'||g,'Asia/Ho_Chi_Minh' FROM generate_series(4,10)g;
INSERT INTO business_hours(tenant_id,branch_id,day_of_week,open_time,close_time,is_closed) SELECT '${tenant}',b.id,d,'09:00','20:00',false FROM branches b CROSS JOIN generate_series(0,6)d WHERE b.code LIKE 'PERF-%';
INSERT INTO services(id,tenant_id,category_id,code,name_json,duration_minutes,base_price_minor,default_duration_min,status) SELECT ('b3000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${tenant}','40000000-0000-4000-8000-000000000001','PERF-'||g,jsonb_build_object('en-US','Performance service '||g),60,100000,60,'ACTIVE' FROM generate_series(1,1970)g;
INSERT INTO staff_profiles(id,tenant_id,employee_code,display_name,status) SELECT ('b2000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${tenant}','PERF-'||g,'Performance staff '||g,'ACTIVE' FROM generate_series(1,485)g;
INSERT INTO staff_branch_assignments(tenant_id,staff_id,branch_id,is_primary,can_be_booked,effective_from) SELECT '${tenant}',('b2000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'20000000-0000-4000-8000-000000000001',false,true,'2026-01-01' FROM generate_series(1,485)g;
WITH branch_list AS(SELECT array_agg(id ORDER BY code) ids FROM branches WHERE tenant_id='${tenant}') INSERT INTO resources(id,tenant_id,branch_id,resource_type_id,code,name,capacity) SELECT ('b1000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${tenant}',ids[((g-1)%10)+1],('45000000-0000-4000-8000-'||lpad((((g-1)%4)+1)::text,12,'0'))::uuid,'PERF-'||g,'Performance resource '||g,1 FROM generate_series(1,4988)g CROSS JOIN branch_list;
INSERT INTO shifts(id,tenant_id,branch_id,staff_id,start_at,end_at,status,source) SELECT ('b4000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${tenant}','20000000-0000-4000-8000-000000000001',('b2000000-0000-4000-8000-'||lpad((((g-1)%485)+1)::text,12,'0'))::uuid,'2026-01-01 09:00+07'::timestamptz+(((g-1)%365)||' days')::interval,'2026-01-01 17:00+07'::timestamptz+(((g-1)%365)||' days')::interval,'DRAFT','IMPORT' FROM generate_series(1,99968)g;
INSERT INTO leave_requests(id,tenant_id,staff_id,branch_id,start_at,end_at,reason,status) SELECT ('b5000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${tenant}',('b2000000-0000-4000-8000-'||lpad((((g-1)%485)+1)::text,12,'0'))::uuid,'20000000-0000-4000-8000-000000000001','2026-01-01 09:00+07'::timestamptz+(((g-1)%365)||' days')::interval,'2026-01-01 17:00+07'::timestamptz+(((g-1)%365)||' days')::interval,'PERF-S3','REJECTED' FROM generate_series(1,49992)g;
WITH branch_list AS(SELECT array_agg(id ORDER BY code) ids FROM branches WHERE tenant_id='${tenant}') INSERT INTO availability_blocks(id,tenant_id,branch_id,resource_id,block_type,title,start_at,end_at,status) SELECT ('b6000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${tenant}',ids[((((g-1)%4988))%10)+1],('b1000000-0000-4000-8000-'||lpad((((g-1)%4988)+1)::text,12,'0'))::uuid,'MANUAL','PERF-'||g,'2026-01-01 10:00+07'::timestamptz+(((g-1)%365)||' days')::interval,'2026-01-01 11:00+07'::timestamptz+(((g-1)%365)||' days')::interval,'ACTIVE' FROM generate_series(1,99997)g CROSS JOIN branch_list;
ALTER TABLE services ENABLE TRIGGER availability_bump_services;ALTER TABLE staff_branch_assignments ENABLE TRIGGER availability_bump_staff_assignments;ALTER TABLE shifts ENABLE TRIGGER availability_bump_shifts;ALTER TABLE leave_requests ENABLE TRIGGER availability_bump_leave;ALTER TABLE resources ENABLE TRIGGER availability_bump_resources;ALTER TABLE availability_blocks ENABLE TRIGGER availability_bump_blocks;ALTER TABLE availability_blocks ENABLE TRIGGER availability_block_target_guard;
UPDATE availability_versions SET version=version+1,updated_at=now() WHERE tenant_id='${tenant}';COMMIT`);
    const counts = (
      await db.query(
        "SELECT (SELECT count(*)::int FROM branches) branches,(SELECT count(*)::int FROM staff_profiles) staff,(SELECT count(*)::int FROM services) services,(SELECT count(*)::int FROM shifts) shifts,(SELECT count(*)::int FROM leave_requests) leave,(SELECT count(*)::int FROM availability_blocks) blocks,(SELECT count(*)::int FROM resources) resources",
      )
    ).rows[0];
    console.log(JSON.stringify(counts));
  }
} finally {
  await db.end();
}
