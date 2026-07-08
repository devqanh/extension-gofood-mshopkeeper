<?php

declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($method !== 'GET') {
    http_response_code(405);
    echo json_encode([
        'ok' => false,
        'error' => 'Phương thức không được hỗ trợ',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$config = require __DIR__ . '/config.php';

$apiBaseUrl = get_api_base_url();

$banks = array_values(array_filter($config['banks'] ?? [], static function (array $bank): bool {
    return ($bank['active'] ?? true) === true
        && !empty($bank['bank_id'])
        && !empty($bank['account_no']);
}));

$payloadBanks = array_map(static function (array $bank): array {
    return [
        'id' => (string) ($bank['id'] ?? ($bank['bank_id'] . '-' . $bank['account_no'])),
        'label' => (string) ($bank['label'] ?? ($bank['bank_id'] . ' - ' . $bank['account_no'])),
        'bankId' => preg_replace('/\s+/', '', (string) $bank['bank_id']),
        'accountNo' => preg_replace('/\s+/', '', (string) $bank['account_no']),
        'accountName' => (string) ($bank['account_name'] ?? ''),
        'template' => (string) ($bank['template'] ?? ($config['defaults']['template'] ?? 'compact2')),
    ];
}, $banks);

echo json_encode([
    'ok' => true,
    'updatedAt' => gmdate('c'),
    'defaults' => [
        'template' => (string) ($config['defaults']['template'] ?? 'compact2'),
        'amount' => (string) ($config['defaults']['amount'] ?? ''),
    ],
    'note' => [
        'prefix' => (string) ($config['note']['prefix'] ?? 'GOFOOD'),
        'maxLength' => (int) ($config['note']['max_length'] ?? 50),
        'uppercase' => (bool) ($config['note']['uppercase'] ?? true),
        'autoOrderCode' => (bool) ($config['note']['auto_order_code'] ?? false),
    ],
    'endpoints' => [
        'invoiceRefs' => $apiBaseUrl . 'invoice-refs.php',
    ],
    'banks' => $payloadBanks,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function get_api_base_url(): string
{
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    $scriptName = (string) ($_SERVER['SCRIPT_NAME'] ?? '');

    if ($host === '' || $scriptName === '') {
        return '';
    }

    $isHttps = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $scheme = $isHttps ? 'https' : 'http';
    $dir = str_replace('\\', '/', dirname($scriptName));
    $dir = trim($dir, '/.');

    return $scheme . '://' . $host . ($dir !== '' ? '/' . $dir : '') . '/';
}
