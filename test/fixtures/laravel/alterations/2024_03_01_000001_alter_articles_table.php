<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('articles', function (Blueprint $table) {
            $table->string('subtitle')->after('title')->nullable();
            $table->renameColumn('old_body', 'body');
            $table->dropColumn('temp_col');
        });
    }
};
