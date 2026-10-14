do $$
declare k text; s text; rid bigint;
begin
  select value into k from integration_settings where key='gallabox_api_key';
  select value into s from integration_settings where key='gallabox_api_secret';
  select net.http_get(url:='https://server.gallabox.com/devapi/accounts',
    headers:=jsonb_build_object('apiKey',k,'apiSecret',s,'content-type','application/json')) into rid;
  raise notice 'req %', rid;
end $$;