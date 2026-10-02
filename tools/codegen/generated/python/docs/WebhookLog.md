# WebhookLog


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**delivery_id** | **str** |  | 
**webhook_id** | **str** |  | 
**url** | **str** |  | [optional] 
**event** | **str** |  | 
**status_code** | **int** |  | [optional] 
**success** | **bool** |  | 
**attempt** | **int** |  | [optional] 
**duration_ms** | **int** |  | [optional] 
**timestamp** | **datetime** |  | [optional] 
**error** | **str** |  | [optional] 

## Example

```python
from soroban_identity_client.models.webhook_log import WebhookLog

# TODO update the JSON string below
json = "{}"
# create an instance of WebhookLog from a JSON string
webhook_log_instance = WebhookLog.from_json(json)
# print the JSON string representation of the object
print(WebhookLog.to_json())

# convert the object into a dict
webhook_log_dict = webhook_log_instance.to_dict()
# create an instance of WebhookLog from a dict
webhook_log_from_dict = WebhookLog.from_dict(webhook_log_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


