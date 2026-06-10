update api_keys
set scopes_json = '["gist:read","gist:write","gist:delete"]'
where domain = 'gist';
