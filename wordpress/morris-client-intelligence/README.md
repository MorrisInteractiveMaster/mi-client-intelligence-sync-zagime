# Morris Client Intelligence

1. In WordPress 6.3 or later, open **Plugins → Add New → Upload Plugin** and install the supplied ZIP.
2. Activate **Morris Client Intelligence**, then open **Settings → Morris Client Intelligence** and review the approved dashboard origin. Set the text, wordmark and theme.
3. Add the **Morris Client Intelligence** block and choose a destination. The shortcode is `[morris_client_portal]`. Use `[morris_client_portal view="history"]` for Reporting History.
4. Preview the page on desktop and mobile. The link opens the secured dashboard at its approved origin. Verify that signing in grants only the permissions already configured for that account.

Named destinations are available on the connected dashboard release. Earlier dashboard releases accept the same launcher URL and show the workspace landing view.

The origin allowlist is shipped in code. A platform maintainer must review and add any new origin before it appears in WordPress settings. The plugin renders a link and stores presentation settings through WordPress. Dashboard authentication and authorization remain on the dashboard.

Plugin code is GPL-2.0-or-later. The supplied Morris Interactive wordmark is a brand asset for the authorized portal launcher.

From the repository root, run `php scripts/test-wordpress-portal.php` and `unzip -t wordpress/morris-client-intelligence.zip`. Preview both the block and shortcode in a local WordPress installation. Check that their links point to the allowlisted portal and the selected destination.
