<?php
/**
 * Plugin Name: Morris Client Intelligence
 * Description: Branded launcher for the secure Morris Interactive client dashboard.
 * Version: 1.0.0
 * Requires at least: 6.3
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 * Text Domain: morris-client-intelligence
 */

defined('ABSPATH') || exit;

function mici_portal_origins() {
    return array('https://mi-client-prod-dashboard-u3xjh6xfkq-nn.a.run.app');
}

function mici_portal_defaults() {
    return array(
        'origin' => mici_portal_origins()[0],
        'title' => __('Client Intelligence', 'morris-client-intelligence'),
        'description' => __('Review delivery, projects and reporting in your secure workspace.', 'morris-client-intelligence'),
        'action' => __('Open dashboard', 'morris-client-intelligence'),
        'theme' => 'navy',
        'logo' => true,
    );
}

function mici_portal_origin($value) {
    if (!is_string($value)) {
        return '';
    }
    $clean = rtrim(trim($value), '/');
    return in_array($clean, mici_portal_origins(), true) ? $clean : '';
}

function mici_portal_views() {
    return array(
        'overview' => __('Leadership Summary', 'morris-client-intelligence'),
        'projects' => __('Projects', 'morris-client-intelligence'),
        'history' => __('Reporting History', 'morris-client-intelligence'),
        'directory' => __('MI Directory', 'morris-client-intelligence'),
        'milestones' => __('Milestones', 'morris-client-intelligence'),
        'area:finance' => __('Finance', 'morris-client-intelligence'),
        'area:hr' => __('HR', 'morris-client-intelligence'),
        'area:cfw' => __('CFW', 'morris-client-intelligence'),
        'area:health' => __('Health', 'morris-client-intelligence'),
        'area:miscellaneous' => __('Miscellaneous', 'morris-client-intelligence'),
        'area:training' => __('Training', 'morris-client-intelligence'),
    );
}

function mici_portal_sanitize($input) {
    $defaults = mici_portal_defaults();
    $input = is_array($input) ? $input : array();
    $origin = mici_portal_origin($input['origin'] ?? '');
    if (!$origin) {
        add_settings_error('mici_portal', 'mici_portal_origin', __('Select an approved portal origin.', 'morris-client-intelligence'));
    }
    $settings = array('origin' => $origin ?: $defaults['origin']);
    foreach (array('title', 'description', 'action') as $key) {
        $text = is_string($input[$key] ?? null) ? sanitize_text_field($input[$key]) : '';
        $settings[$key] = $text ?: $defaults[$key];
    }
    $settings['theme'] = ($input['theme'] ?? '') === 'paper' ? 'paper' : 'navy';
    $settings['logo'] = in_array($input['logo'] ?? '', array(true, '1', 1), true);
    return $settings;
}

function mici_portal_settings() {
    $saved = get_option('mici_portal', array());
    return wp_parse_args(is_array($saved) ? $saved : array(), mici_portal_defaults());
}

function mici_portal_render($attrs = array()) {
    $attrs = is_array($attrs) ? $attrs : array();
    $settings = mici_portal_settings();
    $destinations = mici_portal_views();
    $view = $attrs['view'] ?? 'overview';
    $view = is_string($view) && array_key_exists($view, $destinations) ? $view : 'overview';
    $origin = mici_portal_origin($settings['origin']);
    if (!$origin) {
        return '<p role="status">' . esc_html__('The secure dashboard address is unavailable.', 'morris-client-intelligence') . '</p>';
    }
    $url = $origin . '/secure';
    if ($view !== 'overview') {
        $url = add_query_arg('view', $view, $url);
    }
    wp_enqueue_style('mici-portal');
    wp_enqueue_script('mici-launch');
    $theme = $settings['theme'] === 'paper' ? 'paper' : 'navy';
    $logo = $settings['logo'] ? '<img width="190" height="60" src="' . esc_url(plugins_url('morris-wordmark.png', __FILE__)) . '" alt="Morris Interactive" loading="lazy">' : '';
    return '<section class="mici-portal mici-portal--' . esc_attr($theme) . '" aria-label="' . esc_attr($settings['title']) . '">'
        . '<div class="mici-portal__brand">' . $logo . '<span>' . esc_html($destinations[$view]) . '</span></div>'
        . '<h2>' . esc_html($settings['title']) . '</h2><p>' . esc_html($settings['description']) . '</p>'
        . '<a class="mici-portal__action" rel="noreferrer" href="' . esc_url($url) . '"><span>' . esc_html($settings['action']) . '</span>'
        . '<span class="mici-portal__arrow" aria-hidden="true">↗</span></a>'
        . '<span class="mici-portal__status" role="status" data-opening="' . esc_attr__('Opening secure dashboard…', 'morris-client-intelligence') . '"></span></section>';
}

function mici_portal_admin_register() {
    register_setting('mici_portal', 'mici_portal', array('type' => 'array', 'sanitize_callback' => 'mici_portal_sanitize'));
}

function mici_portal_settings_page() {
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You do not have permission to manage this portal.', 'morris-client-intelligence'));
    }
    $options = mici_portal_settings();
    echo '<div class="wrap"><h1>' . esc_html__('Morris Client Intelligence', 'morris-client-intelligence') . '</h1>';
    settings_errors('mici_portal');
    echo '<form action="options.php" method="post">';
    settings_fields('mici_portal');
    echo '<p><label for="mici-origin">' . esc_html__('Approved dashboard origin', 'morris-client-intelligence') . '</label> <select id="mici-origin" name="mici_portal[origin]">';
    foreach (mici_portal_origins() as $choice) {
        echo '<option value="' . esc_attr($choice) . '"' . selected($options['origin'], $choice, false) . '>' . esc_html($choice) . '</option>';
    }
    echo '</select></p>';
    foreach (array('title' => __('Title', 'morris-client-intelligence'), 'description' => __('Description', 'morris-client-intelligence'), 'action' => __('Button label', 'morris-client-intelligence')) as $name => $label) {
        echo '<p><label for="mici-' . esc_attr($name) . '">' . esc_html($label) . '</label> <input id="mici-' . esc_attr($name)
            . '" class="regular-text" type="text" name="mici_portal[' . esc_attr($name) . ']" value="' . esc_attr($options[$name]) . '"></p>';
    }
    echo '<p><label for="mici-theme">' . esc_html__('Theme', 'morris-client-intelligence') . '</label> <select id="mici-theme" name="mici_portal[theme]">';
    foreach (array('navy' => __('Navy', 'morris-client-intelligence'), 'paper' => __('Paper', 'morris-client-intelligence')) as $theme => $label) {
        echo '<option value="' . esc_attr($theme) . '"' . selected($options['theme'], $theme, false) . '>' . esc_html($label) . '</option>';
    }
    echo '</select></p><p><label><input type="checkbox" name="mici_portal[logo]" value="1"'
        . checked($options['logo'], true, false) . '> ' . esc_html__('Display Morris Interactive wordmark', 'morris-client-intelligence') . '</label></p>';
    submit_button();
    echo '</form></div>';
}

add_action('admin_init', 'mici_portal_admin_register');
add_action('admin_menu', function () {
    add_options_page('Morris Client Intelligence', 'Morris Client Intelligence', 'manage_options', 'mici-portal', 'mici_portal_settings_page');
});
add_action('init', function () {
    wp_register_style('mici-portal', plugins_url('portal.css', __FILE__), array(), '1.0.0');
    wp_register_script('mici-launch', plugins_url('launch.js', __FILE__), array(), '1.0.0', true);
    add_shortcode('morris_client_portal', 'mici_portal_render');
    register_block_type(__DIR__, array('render_callback' => 'mici_portal_render'));
});
add_action('wp_enqueue_scripts', function () {
    $post = get_queried_object();
    if ($post instanceof WP_Post && has_shortcode($post->post_content, 'morris_client_portal')) {
        wp_enqueue_style('mici-portal');
    }
});
