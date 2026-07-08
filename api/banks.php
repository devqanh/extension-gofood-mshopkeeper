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
    'banks' => $payloadBanks,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
