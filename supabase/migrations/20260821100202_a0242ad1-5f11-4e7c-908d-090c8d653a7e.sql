insert into public.integration_settings (key, value)
values ('gallabox_account_id', '61adf636b0cc0c00046772c2')
on conflict (key) do update set value = excluded.value;