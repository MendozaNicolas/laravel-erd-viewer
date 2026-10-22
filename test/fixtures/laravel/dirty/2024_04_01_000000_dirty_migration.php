<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

        $dynamicTable = 'dynamic_' . time();
        Schema::create($dynamicTable, function (Blueprint $table) {
            $table->id();
        });

        Schema::create('valid_in_dirty', function (Blueprint $table) {
            $table->id();
            $table->string('status');
        });
    }
};
