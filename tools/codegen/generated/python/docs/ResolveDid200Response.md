# ResolveDid200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**did_document** | **object** |  | 
**did_resolution_metadata** | **object** |  | 
**did_document_metadata** | **object** |  | 

## Example

```python
from soroban_identity_client.models.resolve_did200_response import ResolveDid200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ResolveDid200Response from a JSON string
resolve_did200_response_instance = ResolveDid200Response.from_json(json)
# print the JSON string representation of the object
print(ResolveDid200Response.to_json())

# convert the object into a dict
resolve_did200_response_dict = resolve_did200_response_instance.to_dict()
# create an instance of ResolveDid200Response from a dict
resolve_did200_response_from_dict = ResolveDid200Response.from_dict(resolve_did200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


