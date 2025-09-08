import { DataTypes } from '@sequelize/core';
import sequelize from '../config/postgressConnect.js';

const CustomAttributeDefinition = sequelize.define(
    'CustomAttributeDefinition',
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        attribute_display_name: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        attribute_key: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        attribute_display_type: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        default_value: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        attribute_model: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        account_id: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        attribute_description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        attribute_values: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: [],
        },
        regex_pattern: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        regex_cue: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    },
    {
        tableName: 'custom_attribute_definitions',
        timestamps: false, // we already have created_at & updated_at
        indexes: [
            {
                unique: true,
                fields: ['attribute_key', 'attribute_model', 'account_id'],
                name: 'attribute_key_model_index',
            },
            {
                fields: ['account_id'],
                name: 'index_custom_attribute_definitions_on_account_id',
            },
        ],
    }
);

export default CustomAttributeDefinition;
