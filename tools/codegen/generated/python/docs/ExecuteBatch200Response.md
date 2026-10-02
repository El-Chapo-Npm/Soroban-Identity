# ExecuteBatch200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**results** | [**List[ExecuteBatch200ResponseResultsInner]**](ExecuteBatch200ResponseResultsInner.md) |  | [optional] 
**summary** | [**ExecuteBatch200ResponseSummary**](ExecuteBatch200ResponseSummary.md) |  | [optional] 
**atomic** | **bool** |  | [optional] 
**aborted** | **bool** |  | [optional] 

## Example

```python
from soroban_identity_client.models.execute_batch200_response import ExecuteBatch200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ExecuteBatch200Response from a JSON string
execute_batch200_response_instance = ExecuteBatch200Response.from_json(json)
# print the JSON string representation of the object
print(ExecuteBatch200Response.to_json())

# convert the object into a dict
execute_batch200_response_dict = execute_batch200_response_instance.to_dict()
# create an instance of ExecuteBatch200Response from a dict
execute_batch200_response_from_dict = ExecuteBatch200Response.from_dict(execute_batch200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


