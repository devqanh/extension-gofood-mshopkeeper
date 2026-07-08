<?php

return [
    'defaults' => [
        'template' => 'compact2',
        'amount' => '',
    ],

    'note' => [
        'prefix' => 'GOFOOD',
        'max_length' => 50,
        'uppercase' => true,
    ],

    'banks' => [
        [
            'id' => 'vcb-main',
            'label' => 'Vietcombank - tài khoản chính',
            'bank_id' => '970436',
            'account_no' => '0123456789',
            'account_name' => 'TÊN CHỦ TÀI KHOẢN',
            'template' => 'compact2',
            'active' => true,
        ],
        [
            'id' => 'mb-backup',
            'label' => 'MBBank - tài khoản dự phòng',
            'bank_id' => '970422',
            'account_no' => '0987654321',
            'account_name' => 'TÊN CHỦ TÀI KHOẢN',
            'template' => 'compact2',
            'active' => false,
        ],
    ],
];
