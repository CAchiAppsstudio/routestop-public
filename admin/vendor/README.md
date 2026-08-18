# Admin vendor assets

`supabase-js-2.105.1.js` is copied from:

`node_modules/@supabase/supabase-js/dist/umd/supabase.js`

Run this after upgrading `@supabase/supabase-js`:

```bash
mkdir -p admin/vendor
cp node_modules/@supabase/supabase-js/dist/umd/supabase.js admin/vendor/supabase-js-<version>.js
```

Then update `admin/index.html` to point to the new local file.
