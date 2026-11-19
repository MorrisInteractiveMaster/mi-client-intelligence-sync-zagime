<?php
// Exercise the real render and validation callbacks with WordPress API test doubles.
define('ABSPATH', __DIR__);
$actions = array();
$registered = array();
$options = array();
$errors = array();
function __($s) { return $s; }
function add_action($name, $callback) { $GLOBALS['actions'][$name] = $callback; }
function add_shortcode($name, $callback) { $GLOBALS['registered'][$name] = $callback; }
function register_block_type($path, $args) {
    $block = json_decode(file_get_contents($path . '/block.json'), true);
    $GLOBALS['registered'][$block['name']] = $args['render_callback'];
}
function register_setting($group, $name, $args) { $GLOBALS['registered'][$name] = $args['sanitize_callback']; }
function add_settings_error($name, $key, $message) { $GLOBALS['errors'][] = $key; }
function wp_register_style() {}
function wp_register_script() {}
function wp_enqueue_style() {}
function wp_enqueue_script() {}
function plugins_url($path) { return $path; }
function get_option($name, $fallback) { return $GLOBALS['options'][$name] ?? $fallback; }
function wp_parse_args($args, $defaults) { return array_merge($defaults, $args); }
function sanitize_text_field($value) { return trim(strip_tags($value)); }
function esc_html($value) { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function esc_attr($value) { return esc_html($value); }
function esc_url($value) { return esc_html($value); }
function esc_html__($value) { return esc_html($value); }
function esc_attr__($value) { return esc_attr($value); }
function add_query_arg($key, $value, $url) { return $url . '?' . rawurlencode($key) . '=' . rawurlencode($value); }
function current_user_can($capability) { return false; }
function wp_die($message) { throw new RuntimeException($message); }
function check($condition, $reason) {
    if (!$condition) {
        throw new RuntimeException($reason);
    }
}

require dirname(__DIR__) . '/wordpress/morris-client-intelligence/morris-client-intelligence.php';
$actions['init']();
$actions['admin_init']();
$shortcode = $registered['morris_client_portal'];
$block = $registered['morris/client-intelligence'];
$sanitize = $registered['mici_portal'];
$origin = mici_portal_origins()[0];

if (($argv[1] ?? '') === '--render') {
    echo $block(array('view' => 'history'));
    exit;
}

check($shortcode(array('view' => 'history')) === $block(array('view' => 'history')), 'Shortcode and block diverged.');
check(strpos($block(array('view' => 'area:finance')), $origin . '/?view=area%3Afinance#/secure') !== false, 'Area route is missing.');
check(strpos($block(), $origin . '/#/secure') !== false, 'The launcher must use the same-origin static entry point.');
check(strpos($shortcode(array('view' => 'https://invalid.example')), 'invalid.example') === false, 'The launcher reflected an arbitrary route.');
foreach (array('http://example.com', $origin . '.evil.test', $origin . '@evil.test', $origin . '/secure', $origin . '?hop=x', array()) as $invalid) {
    check(mici_portal_origin($invalid) === '', 'The allowlist accepted an unauthorized origin.');
}
$options['mici_portal'] = $sanitize(array('origin' => '<script>', 'title' => '<b>Delivery</b>', 'theme' => 'override', 'logo' => '0'));
check($options['mici_portal']['origin'] === $origin && in_array('mici_portal_origin', $errors, true), 'Settings did not flag the rejected origin.');
$html = $shortcode();
check(strpos($html, '<h2>Delivery</h2>') !== false && strpos($html, 'mici-portal--navy') !== false, 'Settings sanitization failed.');
check(strpos($html, '<img') === false && strpos($html, '<iframe') === false, 'Unexpected media or embedded dashboard.');
$options['mici_portal']['origin'] = 'https://unknown.example';
check(strpos($block(), '<a ') === false, 'Corrupted options did not fail closed.');
try {
    mici_portal_settings_page();
    throw new LogicException('Settings page accepted an unprivileged request.');
} catch (RuntimeException $expected) {
    check(strpos($expected->getMessage(), 'permission') !== false, 'Unexpected permission error.');
}
echo "WordPress launcher routing, settings, rendering and permission checks passed.\n";
