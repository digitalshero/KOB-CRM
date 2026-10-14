do $$
declare k text; s text; h jsonb;
begin
  select value into k from integration_settings where key='gallabox_api_key';
  select value into s from integration_settings where key='gallabox_api_secret';
  h := jsonb_build_object('apiKey',k,'apiSecret',s,'content-type','application/json');
  perform net.http_get(url:='https://server.gallabox.com/devapi/accounts/61adf636b0cc0c00046772c2/messages/6a87e16821e2d2eb9ab8cbd8', headers:=h);
end $$;