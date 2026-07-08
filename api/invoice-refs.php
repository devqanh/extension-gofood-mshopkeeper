<?php

declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$config = require __DIR__ . '/config.php';
$storagePath = __DIR__ . '/data/invoice-refs.json';

if ($method === 'GET') {
    handle_list($storagePath);
    exit;
}

if ($method === 'POST') {
    handle_save($storagePath, $config);
    exit;
}

json_response([
    'ok' => false,
    'error' => 'Phương thức không được hỗ trợ',
], 405);

function handle_list(string $storagePath): void
{
    $items = load_items($storagePath);
    $query = strtolower(trim((string) ($_GET['q'] ?? '')));

    if ($query !== '') {
        $items = array_values(array_filter($items, static function (array $item) use ($query): bool {
            $haystack = strtolower(implode(' ', [
                (string) ($item['refNo'] ?? ''),
                (string) ($item['transferNote'] ?? ''),
                (string) ($item['amountText'] ?? ''),
                (string) ($item['sourceUrl'] ?? ''),
            ]));

            return strpos($haystack, $query) !== false;
        }));
    }

    usort($items, static function (array $a, array $b): int {
        return strcmp((string) ($b['updatedAt'] ?? $b['createdAt'] ?? ''), (string) ($a['updatedAt'] ?? $a['createdAt'] ?? ''));
    });

    $total = count($items);
    $perPage = max(1, min(100, (int) ($_GET['perPage'] ?? $_GET['per_page'] ?? 20)));
    $totalPages = max(1, (int) ceil($total / $perPage));
    $page = max(1, min($totalPages, (int) ($_GET['page'] ?? 1)));
    $offset = ($page - 1) * $perPage;

    json_response([
        'ok' => true,
        'page' => $page,
        'perPage' => $perPage,
        'total' => $total,
        'totalPages' => $totalPages,
        'items' => array_slice($items, $offset, $perPage),
    ]);
}

function handle_save(string $storagePath, array $config): void
{
    $input = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($input)) {
        json_response([
            'ok' => false,
            'error' => 'Body JSON không hợp lệ',
        ], 400);
    }

    $prefix = (string) ($config['note']['prefix'] ?? 'GOFOOD');
    $refNo = trim((string) ($input['refNo'] ?? $input['ref_no'] ?? ''));
    $transferNote = normalize_transfer_note((string) ($input['transferNote'] ?? $input['transfer_note'] ?? ''), $prefix);

    if ($refNo === '') {
        json_response([
            'ok' => false,
            'error' => 'Thiếu RefNo',
        ], 422);
    }

    if ($transferNote === '') {
        json_response([
            'ok' => false,
            'error' => 'Thiếu nội dung chuyển khoản hợp lệ',
        ], 422);
    }

    $now = gmdate('c');
    $amount = normalize_amount((string) ($input['amount'] ?? ''));
    $item = [
        'id' => sha1($transferNote . '|' . $refNo),
        'refNo' => $refNo,
        'transferNote' => $transferNote,
        'amount' => $amount,
        'amountText' => (string) ($input['amountText'] ?? $input['amount_text'] ?? ''),
        'bankId' => (string) ($input['bankId'] ?? $input['bank_id'] ?? ''),
        'bankAccountNo' => (string) ($input['bankAccountNo'] ?? $input['bank_account_no'] ?? ''),
        'bankAccountName' => (string) ($input['bankAccountName'] ?? $input['bank_account_name'] ?? ''),
        'sourceUrl' => (string) ($input['sourceUrl'] ?? $input['source_url'] ?? ''),
        'saveSyncStatus' => (int) ($input['saveSyncStatus'] ?? $input['save_sync_status'] ?? 0),
        'saveSyncSuccess' => (bool) ($input['saveSyncSuccess'] ?? $input['save_sync_success'] ?? false),
        'saveSyncResponse' => is_array($input['saveSyncResponse'] ?? null) ? $input['saveSyncResponse'] : null,
        'capturedAt' => (string) ($input['capturedAt'] ?? $input['captured_at'] ?? $now),
        'createdAt' => $now,
        'updatedAt' => $now,
    ];

    $items = update_items($storagePath, static function (array $items) use ($item, $refNo, $transferNote, $config): array {
        $updated = false;

        foreach ($items as $index => $existing) {
            $sameRefNo = (string) ($existing['refNo'] ?? '') === $refNo;
            $sameNote = (string) ($existing['transferNote'] ?? '') === $transferNote;

            if (!$sameRefNo && !$sameNote) {
                continue;
            }

            $items[$index] = array_merge($existing, $item, [
                'createdAt' => (string) ($existing['createdAt'] ?? $item['createdAt']),
                'updatedAt' => $item['updatedAt'],
            ]);
            $updated = true;
            break;
        }

        if (!$updated) {
            array_unshift($items, $item);
        }

        $maxItems = max(100, (int) ($config['storage']['max_invoice_refs'] ?? 5000));
        return array_slice($items, 0, $maxItems);
    });

    $savedItem = null;
    foreach ($items as $existing) {
        if ((string) ($existing['refNo'] ?? '') === $refNo && (string) ($existing['transferNote'] ?? '') === $transferNote) {
            $savedItem = $existing;
            break;
        }
    }

    json_response([
        'ok' => true,
        'item' => $savedItem ?? $item,
    ]);
}

function normalize_transfer_note(string $value, string $prefix): string
{
    $prefix = preg_replace('/[^A-Za-z0-9]+/', '', strtoupper($prefix));
    $compact = preg_replace('/[^A-Za-z0-9]+/', '', strtoupper($value));

    if ($prefix === '' || $compact === '') {
        return '';
    }

    if (preg_match('/^' . preg_quote($prefix, '/') . '(\d{12})/', $compact, $matches) !== 1) {
        return '';
    }

    return $prefix . $matches[1];
}

function normalize_amount(string $value): string
{
    $digits = preg_replace('/\D+/', '', $value);
    if ($digits === null || $digits === '') {
        return '';
    }

    return substr($digits, 0, 13);
}

function load_items(string $storagePath): array
{
    if (!is_file($storagePath)) {
        return [];
    }

    $contents = (string) file_get_contents($storagePath);
    $decoded = json_decode($contents, true);

    return is_array($decoded) ? array_values(array_filter($decoded, 'is_array')) : [];
}

function update_items(string $storagePath, callable $callback): array
{
    $dir = dirname($storagePath);
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        json_response([
            'ok' => false,
            'error' => 'Không tạo được thư mục lưu dữ liệu',
        ], 500);
    }

    $handle = fopen($storagePath, 'c+b');
    if ($handle === false) {
        json_response([
            'ok' => false,
            'error' => 'Không mở được file lưu dữ liệu',
        ], 500);
    }

    try {
        if (!flock($handle, LOCK_EX)) {
            json_response([
                'ok' => false,
                'error' => 'Không khóa được file lưu dữ liệu',
            ], 500);
        }

        rewind($handle);
        $contents = stream_get_contents($handle);
        $decoded = json_decode((string) $contents, true);
        $items = is_array($decoded) ? array_values(array_filter($decoded, 'is_array')) : [];
        $items = $callback($items);

        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, json_encode($items, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        fflush($handle);
        flock($handle, LOCK_UN);
        fclose($handle);

        return $items;
    } catch (Throwable $exception) {
        flock($handle, LOCK_UN);
        fclose($handle);
        throw $exception;
    }
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
