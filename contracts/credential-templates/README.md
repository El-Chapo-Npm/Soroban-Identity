# Credential Templates Contract

## Overview

The Credential Templates contract provides a decentralized system for storing and managing reusable credential templates on the Soroban blockchain. Templates define standardized structures for credentials, making it easier to issue consistent credentials across different issuers.

## Purpose

- **Template Storage**: Store reusable credential templates with predefined fields and structures
- **Schema Integration**: Link templates to registered schemas from the schema-registry contract
- **Access Control**: Ensure only template creators can modify or deactivate their templates
- **Discoverability**: Enable searching and listing of templates by creator
- **Versioning**: Track template creation and updates with timestamps

## Key Features

### Template Management
- Create new credential templates with custom fields and metadata
- Update existing templates (name, description, fields, metadata)
- Deactivate/reactivate templates
- Query templates by ID or creator

### Field Definitions
Templates support various field types:
- String
- Number
- Boolean
- Date
- Email
- URL
- Custom

### Metadata
Each template includes:
- Template ID (unique identifier derived from creator + name + schema)
- Creator address
- Schema reference (links to schema-registry)
- Field definitions with types and requirements
- Metadata (issuer name, version, tags)
- Timestamps (created_at, updated_at)
- Active status

## Usage

### Initialize Contract

```rust
let admin = Address::generate(&env);
client.initialize(&admin);
```

### Create a Template

```rust
let mut fields = Vec::new(&env);
fields.push_back(TemplateField {
    name: String::from_str(&env, "full_name"),
    field_type: FieldType::String,
    required: true,
    description: String::from_str(&env, "Full legal name"),
});

let metadata = TemplateMetadata {
    issuer_name: String::from_str(&env, "Government ID"),
    version: 1,
    tags: vec![String::from_str(&env, "identity")],
};

let template_id = client.create_template(
    &creator,
    &String::from_str(&env, "National ID Template"),
    &String::from_str(&env, "Standard template for national identity cards"),
    &schema_id,
    &fields,
    &metadata,
);
```

### Get a Template

```rust
let template = client.get_template(&template_id);
```

### Update a Template

```rust
client.update_template(
    &creator,
    &template_id,
    &Some(String::from_str(&env, "Updated Template Name")),
    &Some(String::from_str(&env, "Updated description")),
    &None,  // Keep existing fields
    &None,  // Keep existing metadata
);
```

### List Templates by Creator

```rust
let templates = client.get_creator_templates(&creator);

// Or with pagination
let page = client.list_creator_templates(&creator, &None, &10);
```

### Deactivate/Reactivate

```rust
client.deactivate_template(&creator, &template_id);
client.reactivate_template(&creator, &template_id);
```

## Security

- **Authentication**: All state-changing operations require authentication via `require_auth()`
- **Authorization**: Only template creators can update or deactivate their templates
- **Admin Controls**: Contract can be paused/unpaused by admin for emergency situations
- **Input Validation**: All inputs are validated (length limits, required fields, etc.)

## Limits

- Maximum template name length: 256 characters
- Maximum description length: 1024 characters
- Maximum field name length: 128 characters
- Maximum fields per template: 50
- Pagination page cap: 100 items

## Events

The contract emits events for key operations:
- `template_created`: When a new template is created
- `template_updated`: When a template is updated
- `template_deactivated`: When a template is deactivated
- `template_reactivated`: When a template is reactivated
- `contract_paused`/`contract_unpaused`: Admin operations

## Integration

This contract is designed to work alongside:
- **schema-registry**: Templates reference schemas for validation
- **credential-manager**: Templates can be used to issue credentials
- **identity-registry**: Templates help structure identity claims

## Storage

The contract uses Soroban's persistent storage with TTL management:
- TTL Max: ~1 year (6,312,000 ledgers)
- TTL Bump Threshold: Extended when TTL drops below ~11 months
- Automatic TTL extension on reads/writes

## Testing

Run tests with:
```bash
cargo test
```

The contract includes comprehensive tests for:
- Template CRUD operations
- Authorization checks
- Pagination
- Contract lifecycle (pause/unpause)
- Edge cases and error handling

## Version

Current version: 1.0.0

## License

See repository root for license information.
