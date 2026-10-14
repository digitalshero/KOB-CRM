do $$
declare k text; s text; u text; h jsonb;
begin
  select value into k from integration_settings where key='gallabox_api_key';
  select value into s from integration_settings where key='gallabox_api_secret';
  h := jsonb_build_object('apiKey',k,'apiSecret',s,'content-type','application/json');
  foreach u in array array[
    'https://server.gallabox.com/devapi/channels',
    'https://server.gallabox.com/devapi/whatsapp/channels',
    'https://server.gallabox.com/devapi/templates',
    'https://server.gallabox.com/devapi/whatsapp/templates',
    'https://server.gallabox.com/devapi/messages/6a87e16821e2d2eb9ab8cbd8',
    'https://server.gallabox.com/devapi/account',
    'https://server.gallabox.com/devapi/me'
  ] loop
    perform net.http_get(url:=u, headers:=h);
  end loop;
end $$;