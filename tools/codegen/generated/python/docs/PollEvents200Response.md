# PollEvents200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**events** | **List[object]** |  | [optional] 
**last_event_id** | **str** | Cursor to send back on the next call. | [optional] 
**count** | **int** |  | [optional] 
**timed_out** | **bool** |  | [optional] 

## Example

```python
from soroban_identity_client.models.poll_events200_response import PollEvents200Response

# TODO update the JSON string below
json = "{}"
# create an instance of PollEvents200Response from a JSON string
poll_events200_response_instance = PollEvents200Response.from_json(json)
# print the JSON string representation of the object
print(PollEvents200Response.to_json())

# convert the object into a dict
poll_events200_response_dict = poll_events200_response_instance.to_dict()
# create an instance of PollEvents200Response from a dict
poll_events200_response_from_dict = PollEvents200Response.from_dict(poll_events200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


