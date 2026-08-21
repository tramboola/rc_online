alter table cars
  add column steering_trim_percent integer not null default 0,
  add constraint cars_steering_trim_range
    check (steering_trim_percent between -20 and 20);
